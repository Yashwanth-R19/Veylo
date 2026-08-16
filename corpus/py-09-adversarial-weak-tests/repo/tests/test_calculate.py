from main import calculate


def test_calculate_returns_a_value():
    result = calculate(2, 3)
    assert result is not None
