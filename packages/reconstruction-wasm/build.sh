#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
em++ cpp/reconstruction.cpp -std=c++17 -O3 --no-entry \
  -sMODULARIZE=1 -sEXPORT_ES6=1 -sENVIRONMENT=web,worker \
  -sALLOW_MEMORY_GROWTH=1 -sEXPORTED_RUNTIME_METHODS=HEAPU8,HEAPF32,HEAPU32,HEAP32 \
  -sEXPORTED_FUNCTIONS='["_malloc","_free","_recon_build","_recon_positions","_recon_indices","_recon_normals","_recon_vertex_count","_recon_index_count","_recon_occupied","_recon_slice"]' \
  -o dist/reconstruction.mjs
