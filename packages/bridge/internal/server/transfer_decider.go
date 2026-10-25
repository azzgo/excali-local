package server

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/excali-local/excali-bridge/internal/contract"
	"github.com/excali-local/excali-bridge/internal/lan"
	"github.com/excali-local/excali-bridge/internal/peering"
)

// pageDecider asks the active editor page whether to take an incoming Canvas
// transfer (ADR 0013 decision 7). The daemon owns no opinion of its own: it
// forwards the offer and waits. With no page connected, or with the page never
// answering, the offer runs out its own deadline and the sender is told the peer
// did not answer — the daemon never accepts on the user's behalf.
type pageDecider struct {
	srv *Server
}

func (d pageDecider) Decide(ctx context.Context, peer lan.Peer, offer lan.Offer) (peering.Decision, error) {
	wait, err := d.srv.registerOffer(peer, offer)
	if err != nil {
		return peering.Decision{}, err
	}
	defer d.srv.dropOffer(offer.TransferID)

	select {
	case answer := <-wait:
		return answer, nil
	case <-ctx.Done():
		return peering.Decision{}, ctx.Err()
	}
}

// transferOfferNotice is the WS frame the daemon pushes to the active page. It
// carries a TransferOffer and nothing else: no elements, no thumbnail.
type transferOfferNotice struct {
	Type         string `json:"type"`
	TransferID   string `json:"transferId"`
	Alias        string `json:"alias"`
	Fingerprint  string `json:"fingerprint"`
	ElementCount int    `json:"elementCount"`
	Bytes        int    `json:"bytes"`
	CanvasName   string `json:"canvasName"`
	ExpiresAt    int64  `json:"expiresAt"`
}

// registerOffer records a pending offer and pushes it to the active page.
// The returned channel receives the page's answer; the caller selects on it
// together with its own deadline.
func (s *Server) registerOffer(peer lan.Peer, offer lan.Offer) (chan peering.Decision, error) {
	s.mu.Lock()
	active := s.active
	wait := make(chan peering.Decision, 1)
	if active == nil {
		s.mu.Unlock()
		return nil, errors.New("no active canvas page is connected to answer the offer")
	}
	s.offers[offer.TransferID] = wait
	s.mu.Unlock()

	notice := transferOfferNotice{
		Type:         contract.WSTransferOffer,
		TransferID:   offer.TransferID,
		Alias:        offer.Alias,
		Fingerprint:  offer.Fingerprint,
		ElementCount: offer.ElementCount,
		Bytes:        offer.Bytes,
		CanvasName:   offer.CanvasName,
		ExpiresAt:    offer.ExpiresAt,
	}
	if err := s.sendJSON(active.conn, notice); err != nil {
		s.dropOffer(offer.TransferID)
		return nil, err
	}
	return wait, nil
}

func (s *Server) dropOffer(transferID string) {
	s.mu.Lock()
	delete(s.offers, transferID)
	s.mu.Unlock()
}

// answerOffer routes a page's `peers.transferRespond` request to the waiting
// Decide call. A response for an offer nobody waits on is refused rather than
// silently accepted: a late accept must never take effect.
func (s *Server) answerOffer(transferID string, accept bool, reason string) error {
	s.mu.Lock()
	wait, ok := s.offers[transferID]
	if ok {
		delete(s.offers, transferID)
	}
	s.mu.Unlock()
	if !ok {
		return errors.New("this offer is no longer pending")
	}
	select {
	case wait <- peering.Decision{Accept: accept, Reason: reason}:
	default:
		return errors.New("this offer was already answered")
	}
	return nil
}

// transferRespond is the page's answer to a pushed offer. The page is the only
// party allowed to decide, and only while the offer is still pending: a late
// answer is refused so an expired offer can never take effect.
func (s *Server) transferRespond(cl *client, id json.RawMessage, params json.RawMessage) {
	var req struct {
		TransferID string `json:"transferId"`
		Accept     bool   `json:"accept"`
		Reason     string `json:"reason"`
	}
	if len(params) > 0 {
		if err := json.Unmarshal(params, &req); err != nil {
			s.sendRPCError(cl, id, -32602, "invalid params: want {transferId, accept, reason}")
			return
		}
	}
	if req.TransferID == "" {
		s.sendRPCError(cl, id, -32602, "invalid params: transferId is required")
		return
	}
	s.mu.Lock()
	isActive := s.active == cl
	s.mu.Unlock()
	if !isActive {
		s.sendRPCError(cl, id, contract.JSONRPCErrorRequiresActivePage,
			"only the active canvas page may answer a transfer offer")
		return
	}
	if err := s.answerOffer(req.TransferID, req.Accept, req.Reason); err != nil {
		s.sendRPCError(cl, id, contract.JSONRPCErrorOfferExpired, err.Error())
		return
	}
	s.sendRPCResult(cl, id, map[string]any{"answered": true, "accept": req.Accept})
}
