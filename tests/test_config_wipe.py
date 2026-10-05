"""Regression suite for config_viewer._apply_patch (F-M6-01 family).

Historical bugs covered here:
- editing a field inside an object-array item wiped the entire list;
- malformed paths (dict key inside a list, scalar mid-path, bad indexes)
  silently clobbered unrelated config.

Invariant: the config survives UNCHANGED unless the edit path is well-formed.
"""

import copy

from backend.config_viewer import _apply_patch

BASE = {
    "model": {"default": "test-model", "providers": {"prov_a": {"url": "http://a"}}},
    "fallback_providers": [
        {"provider": "prov_a", "model": "model-1"},
        {"provider": "prov_b", "model": "model-2"},
        {"provider": "prov_c", "model": "model-3"},
    ],
    "agents": ["alpha", "beta", "gamma"],
    "toggles": [True, False],
    "scalar": "hello",
}


def cfg():
    return copy.deepcopy(BASE)


def test_edit_inside_object_array_item_keeps_list():
    r = _apply_patch(cfg(), ["fallback_providers", "[0]", "provider"], "prov_x")
    assert isinstance(r["fallback_providers"], list)
    assert len(r["fallback_providers"]) == 3
    assert r["fallback_providers"][0]["provider"] == "prov_x"


def test_edit_inside_object_array_item_spares_siblings():
    r = _apply_patch(cfg(), ["fallback_providers", "[0]", "provider"], "prov_x")
    assert r["fallback_providers"][1]["model"] == "model-2"
    assert r["fallback_providers"][2]["model"] == "model-3"


def test_plain_dict_path_edit():
    r = _apply_patch(cfg(), ["model", "default"], "model-z")
    assert r["model"]["default"] == "model-z"


def test_whole_array_replacement():
    r = _apply_patch(cfg(), ["agents"], ["alpha", "delta"])
    assert r["agents"] == ["alpha", "delta"]


def test_primitive_array_item_edit():
    r = _apply_patch(cfg(), ["agents", "[1]"], "delta")
    assert r["agents"] == ["alpha", "delta", "gamma"]


def test_boolean_array_item_edit():
    r = _apply_patch(cfg(), ["toggles", "[0]"], False)
    assert r["toggles"] == [False, False]


def test_new_nested_path_creation():
    r = _apply_patch(cfg(), ["model", "providers", "prov_new", "api_key_ref"], "k")
    assert r["model"]["providers"].get("prov_new", {}).get("api_key_ref") == "k"


def test_dict_key_inside_list_is_noop():
    r = _apply_patch(cfg(), ["agents", "foo", "bar"], 1)
    assert r["agents"] == BASE["agents"]


def test_scalar_mid_path_is_noop():
    r = _apply_patch(cfg(), ["scalar", "deeper"], 1)
    assert r["scalar"] == "hello"


def test_out_of_range_index_is_noop():
    r = _apply_patch(cfg(), ["agents", "[9]"], "x")
    assert r["agents"] == BASE["agents"]


def test_negative_index_is_noop():
    r = _apply_patch(cfg(), ["agents", "[-1]"], "x")
    assert r["agents"] == BASE["agents"]


def test_non_numeric_index_is_noop():
    r = _apply_patch(cfg(), ["agents", "[abc]"], "x")
    assert r["agents"] == BASE["agents"]


def test_final_dict_key_on_list_is_noop():
    r = _apply_patch(cfg(), ["agents", "foo"], "x")
    assert r["agents"] == BASE["agents"]
