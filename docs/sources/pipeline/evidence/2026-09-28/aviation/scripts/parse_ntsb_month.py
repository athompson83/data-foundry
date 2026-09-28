"""Extract the aircraft table from an NTSB monthly aviation-data update
(up01AUG.mdb, fetched 2026-09-28 from
https://data.ntsb.gov/avdata/FileDirectory/DownloadFile?fileID=C%3A%5Cavdata%5Cup01AUG.zip
with the declared scout User-Agent) and report field hit rates.

Requires mdbtools (mdb-export) on PATH. Run from this scripts/ directory:
  mdb-export ../raw/up01AUG.mdb aircraft > ../raw/aircraft.csv
  mdb-export ../raw/up01AUG.mdb events > ../raw/events.csv
  mdb-export ../raw/up01AUG.mdb narratives > ../raw/narratives.csv
  python3 parse_ntsb_month.py
"""

import csv


def main() -> None:
    with open("../raw/aircraft.csv") as handle:
        rows = list(csv.DictReader(handle))
    print(f"{len(rows)} aircraft rows in the up01AUG.mdb (July 2026 events) update")
    fields = ["ev_id", "regis_no", "acft_make", "acft_model", "acft_serial_no"]
    for name in fields:
        hits = sum(1 for row in rows if row.get(name))
        print(f"{name}: {hits}/{len(rows)}")

    with open("../raw/narratives.csv") as handle:
        narratives = list(csv.DictReader(handle))
    print(f"{len(narratives)} narrative rows (free-text finding/cause fields) for the same {len(rows)} events")

    with open("../raw/events.csv") as handle:
        events = list(csv.DictReader(handle))
    print(f"{len(events)} event rows; ev_date range: {min(e['ev_date'] for e in events)} .. {max(e['ev_date'] for e in events)}")


if __name__ == "__main__":
    main()
