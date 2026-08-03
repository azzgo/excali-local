// Package fonts enumerates OS-installed fonts for the fonts/v1 refinement
// (Wayfinder Ticket 015, goal 4): fonts.system.list is DAEMON-LOCAL — the
// daemon scans the standard font directories and parses each font's sfnt
// 'name' table for family (nameID 1) and postscriptName (nameID 6).
//
// Pure Go, no cgo, stdlib only — preserving the daemon's offline single-static-
// binary + cross-platform story (no golang.org/x/image dependency, no module
// downloads). .woff2 is skipped (brotli-compressed; would need a non-stdlib
// dependency); .ttf/.otf/.ttc/.woff are parsed.
package fonts

import (
	"bytes"
	"compress/zlib"
	"encoding/binary"
	"errors"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
)

// Font is one enumerated OS font.
type Font struct {
	Family         string `json:"family"`
	PostscriptName string `json:"postscriptName"`
}

// fontDirs returns the standard font directories for the current OS.
func fontDirs() []string {
	home, _ := os.UserHomeDir()
	switch runtime.GOOS {
	case "darwin":
		return []string{
			filepath.Join(home, "Library", "Fonts"),
			"/Library/Fonts",
			"/System/Library/Fonts",
		}
	case "windows":
		dirs := []string{filepath.Join(os.Getenv("WINDIR"), "Fonts")}
		if local := os.Getenv("LOCALAPPDATA"); local != "" {
			dirs = append(dirs, filepath.Join(local, "Microsoft", "Windows", "Fonts"))
		}
		return dirs
	default: // linux + others
		dirs := []string{"/usr/share/fonts", "/usr/local/share/fonts"}
		if home != "" {
			dirs = append(dirs, filepath.Join(home, ".fonts"))
			dataHome := os.Getenv("XDG_DATA_HOME")
			if dataHome == "" {
				dataHome = filepath.Join(home, ".local", "share")
			}
			dirs = append(dirs, filepath.Join(dataHome, "fonts"))
		}
		return dirs
	}
}

// EnumerateOSFonts scans the standard font dirs and returns every
// {family, postscriptName} it can parse, deduped by postscriptName (first
// occurrence wins) and sorted by family. Unreadable entries and unparseable
// files are skipped silently.
func EnumerateOSFonts() ([]Font, error) {
	seen := map[string]Font{}
	var order []string
	for _, dir := range fontDirs() {
		_ = filepath.WalkDir(dir, func(path string, d os.DirEntry, err error) error {
			if err != nil || d.IsDir() {
				return nil
			}
			ext := strings.ToLower(filepath.Ext(path))
			if ext != ".ttf" && ext != ".otf" && ext != ".ttc" && ext != ".woff" {
				return nil // .woff2 needs brotli — out of the offline stdlib story
			}
			data, err := os.ReadFile(path)
			if err != nil {
				return nil
			}
			families, err := ParseNameTable(data)
			if err != nil {
				return nil
			}
			for _, f := range families {
				if f.PostscriptName == "" {
					continue
				}
				if _, dup := seen[f.PostscriptName]; !dup {
					seen[f.PostscriptName] = f
					order = append(order, f.PostscriptName)
				}
			}
			return nil
		})
	}
	out := make([]Font, 0, len(order))
	for _, ps := range order {
		out = append(out, seen[ps])
	}
	sort.Slice(out, func(i, j int) bool {
		return strings.ToLower(out[i].Family) < strings.ToLower(out[j].Family)
	})
	return out, nil
}

// ---------------------------------------------------------------------------
// sfnt name-table parsing
// ---------------------------------------------------------------------------

// ParseNameTable extracts {family (nameID 1), postscriptName (nameID 6)} from
// the 'name' table(s) of a TTF/OTF sfnt, a TrueType Collection (.ttc, one Font
// per embedded face), or a WOFF font (zlib-inflating tables when compressed).
// Returns one Font per embedded face.
func ParseNameTable(data []byte) ([]Font, error) {
	dirs, err := collectTableDirs(data)
	if err != nil {
		return nil, err
	}
	out := make([]Font, 0, len(dirs))
	for _, tables := range dirs {
		tbl, ok := tables["name"]
		if !ok {
			continue
		}
		fam, ps := parseNameTable(tbl)
		if fam == "" && ps == "" {
			continue
		}
		out = append(out, Font{Family: fam, PostscriptName: ps})
	}
	if len(out) == 0 {
		return nil, errors.New("no parseable name table")
	}
	return out, nil
}

// collectTableDirs returns the table directories (tag → raw table bytes) for
// every embedded font in the given container bytes.
func collectTableDirs(data []byte) ([]map[string][]byte, error) {
	switch {
	case len(data) >= 4 && string(data[0:4]) == "ttcf":
		var out []map[string][]byte
		for _, b := range ttcBases(data) {
			if t, err := sfntTables(data, b); err == nil {
				out = append(out, t)
			}
		}
		if len(out) == 0 {
			return nil, errors.New("no ttc faces parsed")
		}
		return out, nil
	case len(data) >= 4 && string(data[0:4]) == "wOFF":
		t, err := woffTables(data)
		if err != nil {
			return nil, err
		}
		return []map[string][]byte{t}, nil
	case len(data) >= 4 &&
		(binary.BigEndian.Uint32(data[0:4]) == 0x00010000 || string(data[0:4]) == "OTTO"):
		t, err := sfntTables(data, 0)
		if err != nil {
			return nil, err
		}
		return []map[string][]byte{t}, nil
	default:
		return nil, errors.New("unsupported font container")
	}
}

// sfntTables parses the table directory located at data[base:]. Per the
// OpenType spec, table DATA offsets inside a directory are relative to the
// beginning of the FILE (for a TTC, the file itself; for a plain sfnt with
// base=0 both interpretations coincide).
func sfntTables(data []byte, base int) (map[string][]byte, error) {
	if len(data) < base+12 {
		return nil, errors.New("sfnt too short")
	}
	d := data[base:]
	numTables := int(binary.BigEndian.Uint16(d[4:6]))
	off := 12
	tables := map[string][]byte{}
	for i := 0; i < numTables; i++ {
		if off+16 > len(d) {
			return nil, errors.New("table directory truncated")
		}
		tag := string(d[off : off+4])
		toff := int(binary.BigEndian.Uint32(d[off+8 : off+12]))
		tlen := int(binary.BigEndian.Uint32(d[off+12 : off+16]))
		if toff >= 0 && tlen >= 0 && toff+tlen <= len(data) {
			tables[tag] = data[toff : toff+tlen]
		}
		off += 16
	}
	return tables, nil
}

// ttcBases returns the file offsets of every embedded sfnt table directory
// in a TrueType Collection.
func ttcBases(data []byte) []int {
	if len(data) < 12 {
		return nil
	}
	num := int(binary.BigEndian.Uint32(data[8:12]))
	out := make([]int, 0, num)
	for i := 0; i < num; i++ {
		pos := 12 + i*4
		if pos+4 > len(data) {
			break
		}
		out = append(out, int(binary.BigEndian.Uint32(data[pos:pos+4])))
	}
	return out
}

// woffTables parses a WOFF container's table directory, zlib-inflating tables
// whose compressed length is smaller than the original length.
func woffTables(data []byte) (map[string][]byte, error) {
	if len(data) < 44 {
		return nil, errors.New("woff too short")
	}
	numTables := int(binary.BigEndian.Uint16(data[12:14]))
	off := 44
	tables := map[string][]byte{}
	for i := 0; i < numTables; i++ {
		if off+20 > len(data) {
			return nil, errors.New("woff directory truncated")
		}
		tag := string(data[off : off+4])
		toff := int(binary.BigEndian.Uint32(data[off+4 : off+8]))
		compLen := int(binary.BigEndian.Uint32(data[off+8 : off+12]))
		origLen := int(binary.BigEndian.Uint32(data[off+12 : off+16]))
		if toff < 0 || compLen < 0 || toff+compLen > len(data) {
			off += 20
			continue
		}
		raw := data[toff : toff+compLen]
		if compLen < origLen {
			if zr, err := zlib.NewReader(bytes.NewReader(raw)); err == nil {
				if inflated, err := io.ReadAll(zr); err == nil && len(inflated) == origLen {
					tables[tag] = inflated
				}
			}
		} else {
			tables[tag] = raw
		}
		off += 20
	}
	return tables, nil
}

// nameRecord is one 12-byte name-table record.
type nameRecord struct {
	platformID uint16
	nameID     uint16
	length     uint16
	offset     uint16
}

// parseNameTable extracts the best family (nameID 1) + postscriptName (nameID 6)
// records, preferring Windows (platform 3) over Unicode (0) over Mac (1).
func parseNameTable(tbl []byte) (family, postscriptName string) {
	if len(tbl) < 6 {
		return "", ""
	}
	count := int(binary.BigEndian.Uint16(tbl[2:4]))
	strOff := int(binary.BigEndian.Uint16(tbl[4:6]))
	records := make([]nameRecord, 0, count)
	for i := 0; i < count; i++ {
		pos := 6 + i*12
		if pos+12 > len(tbl) {
			break
		}
		records = append(records, nameRecord{
			platformID: binary.BigEndian.Uint16(tbl[pos : pos+2]),
			nameID:     binary.BigEndian.Uint16(tbl[pos+6 : pos+8]),
			length:     binary.BigEndian.Uint16(tbl[pos+8 : pos+10]),
			offset:     binary.BigEndian.Uint16(tbl[pos+10 : pos+12]),
		})
	}
	return pickName(records, tbl, strOff, 1), pickName(records, tbl, strOff, 6)
}

func pickName(records []nameRecord, tbl []byte, strOff, nameID int) string {
	// Prefer Windows (3) → Unicode (0) → Mac (1); decode by platform so
	// Mac single-byte records are never misread as UTF-16BE.
	for _, plat := range []uint16{3, 0, 1} {
		for _, r := range records {
			if int(r.nameID) != nameID || r.platformID != plat {
				continue
			}
			start := strOff + int(r.offset)
			if start < 0 || start+int(r.length) > len(tbl) {
				continue
			}
			if s := decodeName(tbl[start:start+int(r.length)], plat); s != "" {
				return s
			}
		}
	}
	return ""
}

// decodeName decodes a name-table string by platform: platform 0 (Unicode)
// and 3 (Windows) are UTF-16BE; platform 1 (Mac) and 2 (ISO) are single-byte
// (MacRoman/ASCII — the ASCII subset is what matters for family/PS names).
func decodeName(b []byte, platformID uint16) string {
	if platformID == 1 || platformID == 2 || len(b)%2 != 0 {
		return string(b)
	}
	// UTF-16BE (skip a BOM if present).
	start := 0
	if len(b) >= 2 && binary.BigEndian.Uint16(b[0:2]) == 0xFEFF {
		start = 2
	}
	var sb strings.Builder
	sb.Grow((len(b) - start) / 2)
	for i := start; i+1 < len(b); i += 2 {
		r := rune(binary.BigEndian.Uint16(b[i : i+2]))
		if r == 0 {
			continue
		}
		sb.WriteRune(r)
	}
	return sb.String()
}
