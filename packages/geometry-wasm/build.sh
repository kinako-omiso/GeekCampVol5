#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
em++ cpp/geometry.cpp -std=c++17 -O3 --no-entry \
  -sMODULARIZE=1 -sEXPORT_ES6=1 -sENVIRONMENT=web,worker \
  -sALLOW_MEMORY_GROWTH=1 -sEXPORTED_RUNTIME_METHODS=HEAPU8,HEAPF32,HEAPU32,HEAP32 \
  -sEXPORTED_FUNCTIONS='["_malloc","_free","_geom_analyze","_geom_value","_geom_hull_positions","_geom_hull_indices","_geom_hull_vertex_count","_geom_hull_index_count"]' \
  -o dist/geometry.mjs
