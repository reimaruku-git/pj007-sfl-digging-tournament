from pathlib import Path

TEMPLATE = Path(__file__).resolve().parents[2] / "template.yaml"


def test_farm_sync_schedule_is_1400_1600_1800_2000_2300_utc():
    text = TEMPLATE.read_text()
    assert "rate(15 minutes)" not in text
    assert "cron(0 14,16,18,20,23 * * ? *)" in text
    assert "Enabled: true" in text
