"""
Map's method families, one module each, bound in the Map class body the same
way the layer builders in layers/ are. map.py keeps the widget's identity --
traits, constructor, lifecycle (sync/batch/resync) -- and everything else
lives here: transport (patch ops and the layers-list invariants), marginalia
(draw and scale), legend, bounds, access, effects, time.
"""
