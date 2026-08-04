"""
Input shapes shared by the pandas and polars test modules.

Both are exercised against the identical expectations here on purpose: their multi-row
grouping is implemented separately (pandas groups sub-frames, polars uses a native
group_by/agg) and only a shared case table catches the two drifting apart.

Each case is (id, build, expected) where `build` takes a DataFrame constructor.
"""
from geometry import (
    A, B, C, LINE, RING, RING_OPEN, SECOND_LINE, SECOND_RING,
    wkt_point, wkt_multipoint, wkt_line, wkt_polygon,
)

# --- points -----------------------------------------------------------------------
POINT_CASES = [
    ("lat_lon",
     lambda mk: mk({"lat": [A[0], B[0]], "lon": [A[1], B[1]]}),
     [A, B]),

    ("latitude_longitude",
     lambda mk: mk({"latitude": [A[0], B[0]], "longitude": [A[1], B[1]]}),
     [A, B]),

    ("y_x",
     lambda mk: mk({"y": [A[0], B[0]], "x": [A[1], B[1]]}),
     [A, B]),

    ("lng_alias",
     lambda mk: mk({"lat": [A[0], B[0]], "lng": [A[1], B[1]]}),
     [A, B]),

    ("wkt_point_column",
     lambda mk: mk({"geometry": [wkt_point(A), wkt_point(B)]}),
     [A, B]),

    ("wkt_multipoint_expands",
     lambda mk: mk({"geometry": [wkt_multipoint([A, B, C])]}),
     [A, B, C]),

    ("single_row",
     lambda mk: mk({"lat": [A[0]], "lon": [A[1]]}),
     [A]),
]

# --- lines ------------------------------------------------------------------------
LINE_CASES = [
    ("wkt_linestring",
     lambda mk: mk({"wkt": [wkt_line(LINE)]}),
     [LINE]),

    ("wide_vertex_columns",
     lambda mk: mk({"lat1": [A[0]], "lon1": [A[1]],
                    "lat2": [B[0]], "lon2": [B[1]],
                    "lat3": [C[0]], "lon3": [C[1]]}),
     [LINE]),

    ("list_of_pairs_in_cell",
     lambda mk: mk({"coords": [[list(A), list(B), list(C)]]}),
     [LINE]),

    ("plain_latlon_single_line",
     lambda mk: mk({"lat": [p[0] for p in LINE], "lon": [p[1] for p in LINE]}),
     [LINE]),

    ("grouped_by_track_id",
     lambda mk: mk({"track_id": ["T1", "T1", "T1", "T2", "T2"],
                    "lat": [A[0], B[0], C[0]] + [p[0] for p in SECOND_LINE],
                    "lon": [A[1], B[1], C[1]] + [p[1] for p in SECOND_LINE]}),
     [LINE, SECOND_LINE]),

    ("two_wkt_rows",
     lambda mk: mk({"wkt": [wkt_line(LINE), wkt_line(SECOND_LINE)]}),
     [LINE, SECOND_LINE]),
]

# --- polygons ---------------------------------------------------------------------
POLYGON_CASES = [
    ("wkt_polygon",
     lambda mk: mk({"wkt": [wkt_polygon(RING)]}),
     [RING]),

    ("wide_vertex_columns",
     lambda mk: mk({"lat1": [RING_OPEN[0][0]], "lon1": [RING_OPEN[0][1]],
                    "lat2": [RING_OPEN[1][0]], "lon2": [RING_OPEN[1][1]],
                    "lat3": [RING_OPEN[2][0]], "lon3": [RING_OPEN[2][1]]}),
     [RING]),

    ("plain_latlon_single_ring",
     lambda mk: mk({"lat": [p[0] for p in RING_OPEN], "lon": [p[1] for p in RING_OPEN]}),
     [RING]),

    ("grouped_by_shape_id",
     lambda mk: mk({"shape_id": ["Z1"] * 3 + ["Z2"] * 3,
                    "lat": [p[0] for p in RING_OPEN] + [p[0] for p in SECOND_RING[:3]],
                    "lon": [p[1] for p in RING_OPEN] + [p[1] for p in SECOND_RING[:3]]}),
     [RING, SECOND_RING]),

    ("two_wkt_rows",
     lambda mk: mk({"wkt": [wkt_polygon(RING), wkt_polygon(SECOND_RING)]}),
     [RING, SECOND_RING]),
]
