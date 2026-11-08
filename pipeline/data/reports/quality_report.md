# VisitWell data quality report

## Sources

| source | status | retrieved_at | sha256 |
|---|---|---|---|
| flunet_dictionary | ok | 2026-11-08T01:21:14+00:00 | 60d601095615 |
| flunet | ok | 2026-11-08T01:21:24+00:00 | de4bae324d77 |
| opendengue_national | ok | 2026-11-08T01:21:25+00:00 | d4fa7b1a8814 |
| opendengue_spatial | ok | 2026-11-08T01:21:29+00:00 | 69f6f798bc73 |
| opendengue_temporal | ok | 2026-11-08T01:21:38+00:00 | 7f5df2174404 |
| measles_who | ok | 2026-11-08T01:21:45+00:00 | 9eca717c0f06 |
| population | ok | 2026-11-08T01:21:46+00:00 | 4343dbdfefbb |
| malaria_who | ok | 2026-11-08T01:21:50+00:00 | 73c5dc5f8490 |
| malaria_map | missing (manual download, optional) |  |  |

## Coverage per disease x country

| disease | iso3 | level | first | last | % missing months | complete years | data as of |
|---|---|---|---|---|---|---|---|
| influenza | VNM | national | 2006-01-01 | 2026-10-01 | 11.2 | 15 | 2026-10-26 |
| influenza | PHL | national | 2002-07-01 | 2026-10-01 | 22.9 | 10 | 2026-10-19 |
| influenza | IND | national | 2000-06-01 | 2026-10-01 | 32.2 | 14 | 2026-10-26 |
| influenza | CHN | national | 2005-10-01 | 2026-10-01 | 7.5 | 16 | 2026-10-26 |
| influenza | MEX | national | 2000-01-01 | 2026-10-01 | 14.0 | 16 | 2026-10-26 |
| influenza | BRA | national | 2003-03-01 | 2026-10-01 | 13.0 | 13 | 2026-10-26 |
| dengue | VNM | national | 1995-01-01 | 2025-03-01 | 24.8 | 22 | 2025-03-31 |
| dengue | PHL | national | 2011-01-01 | 2023-11-01 | 12.9 | 5 | 2023-11-25 |
| dengue | IND | national | 2024-01-01 | 2025-01-01 | 7.7 | 0 | 2025-01-31 |
| dengue | CHN | national | 1998-01-01 | 2025-02-01 | 30.1 | 18 | 2025-02-28 |
| dengue | MEX | national | 2003-01-01 | 2024-12-01 | 27.3 | 16 | 2024-12-28 |
| dengue | BRA | national | 2014-01-01 | 2024-12-01 | 0.0 | 11 | 2024-12-28 |
| dengue | BRA | admin1 | 1993-01-01 | 2024-12-01 |  | 24 | 2024-12-28 |
| dengue | CHN | admin1 | 1998-01-01 | 2009-12-01 |  | 8 | 2009-12-31 |
| dengue | MEX | admin1 | 2003-01-01 | 2022-07-01 |  | 8 | 2022-12-31 |
| dengue | PHL | admin1 | 1994-01-01 | 2010-12-01 |  | 14 | 2010-12-31 |
| dengue | VNM | admin1 | 1994-02-01 | 2010-12-01 |  | 16 | 2010-12-31 |
| measles | VNM | national | 2012-01-01 | 2025-02-01 | 0.0 | 13 | 2025-02-01 |
| measles | PHL | national | 2012-01-01 | 2026-09-01 | 0.0 | 14 | 2026-09-01 |
| measles | IND | national | 2014-01-01 | 2026-09-01 | 0.0 | 12 | 2026-09-01 |
| measles | CHN | national | 2012-01-01 | 2026-08-01 | 0.6 | 13 | 2026-08-01 |
| measles | MEX | national | 2014-01-01 | 2026-09-01 | 7.8 | 11 | 2026-09-01 |
| measles | BRA | national | 2014-01-01 | 2026-09-01 | 0.0 | 12 | 2026-09-01 |
| malaria | VNM | national | 2000-01-01 | 2024-01-01 |  | 25 | 2024-12-31 |
| malaria | PHL | national | 2000-01-01 | 2024-01-01 |  | 25 | 2024-12-31 |
| malaria | IND | national | 2000-01-01 | 2024-01-01 |  | 25 | 2024-12-31 |
| malaria | CHN | national | 2000-01-01 | 2024-01-01 |  | 23 | 2024-12-31 |
| malaria | MEX | national | 2000-01-01 | 2024-01-01 |  | 25 | 2024-12-31 |
| malaria | BRA | national | 2000-01-01 | 2024-01-01 |  | 25 | 2024-12-31 |

## Notes

Fewer than 5 complete years (seasonal profile = insufficient_data): dengue/IND

Influenza complete-year counts include the excluded baseline years [2020, 2021], which are dropped later in the seasonal profile.
