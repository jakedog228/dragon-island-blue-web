from dib_extract.cocos import parse_point, parse_rect

def test_parse_point_integers():
    assert parse_point("{12,34}") == (12.0, 34.0)

def test_parse_point_whitespace_and_float():
    assert parse_point("{ 0 , 32.5 }") == (0.0, 32.5)

def test_parse_rect():
    assert parse_rect("{{127,119},{94,88}}") == (127.0, 119.0, 94.0, 88.0)

def test_parse_point_rejects_rect():
    import pytest
    with pytest.raises(ValueError):
        parse_point("{{1,2},{3,4}}")
