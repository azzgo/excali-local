import React from "react";

/** Named export spike — proves WXT/Vite compile a cross-package .tsx. */
export function Spike() {
  return <div>spike</div>;
}

/** Default export spike — proves default-export interop across bundlers. */
export default function SpikeDefault() {
  return <div>spike</div>;
}
