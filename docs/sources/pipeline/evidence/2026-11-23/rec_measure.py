#!/usr/bin/env python3
"""Round 32 (2026-11-23): federal recreation areas and facilities. The Recreation Information Database
full CSV export and the USDA Forest Service Recreation Opportunities layer. Writes rec_measure.json."""
import collections, csv, html, io, json, random, re, statistics, zipfile
import scoutlib as s

csv.field_size_limit(10**9)
out = {"run_date": "2026-11-23"}
z = zipfile.ZipFile(io.BytesIO(s.get("ridb_zip", "https://ridb.recreation.gov/downloads/RIDBFullExport_V1_CSV.zip")))
out["ridb_members"] = {i.filename: i.file_size for i in z.infolist()}
read = lambda n: list(csv.DictReader(io.TextIOWrapper(z.open(n), encoding="utf-8", errors="replace", newline="")))
strip = lambda t: re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", t or ""))).strip()
orgs = {o["OrgID"]: o["OrgAbbrevName"] or o["OrgName"] for o in read("Organizations_API_v1.csv")}
areas, fac = read("RecAreas_API_v1.csv"), read("Facilities_API_v1.csv")
ad = [strip(a["RecAreaDescription"]) for a in areas]
fd = [strip(f["FacilityDescription"]) for f in fac]
fdir = [strip(f["FacilityDirections"]) for f in fac]
# In the Facilities file the organisation id is in the column headed OrgFacilityID and the agency's own
# facility id in the column headed ParentOrgID (first row: OrgFacilityID 131, ParentOrgID empty).
out["ridb"] = {
    "organizations": len(orgs),
    "rec_areas": len(areas), "rec_areas_by_org": {orgs.get(k, k): v for k, v in collections.Counter(a["ParentOrgID"] for a in areas).most_common(12)},
    "rec_areas_with_org_rec_area_id": sum(1 for a in areas if a["OrgRecAreaID"].strip()),
    "rec_areas_with_description": sum(1 for t in ad if t), "rec_area_description_characters": sum(map(len, ad)),
    "rec_area_description_median_characters": statistics.median(len(t) for t in ad if t),
    "facilities": len(fac), "facilities_by_type": dict(collections.Counter(f["FacilityTypeDescription"] for f in fac).most_common(12)),
    "facilities_by_value_in_column_OrgFacilityID": {orgs.get(k, k): v for k, v in collections.Counter(f["OrgFacilityID"] for f in fac).most_common(10)},
    "facilities_with_a_value_in_column_ParentOrgID": sum(1 for f in fac if f["ParentOrgID"].strip()),
    "facilities_reservable": sum(1 for f in fac if f["Reservable"] == "true"),
    "facilities_with_description": sum(1 for t in fd if t), "facility_description_characters": sum(map(len, fd)),
    "facility_description_median_characters": statistics.median(len(t) for t in fd if t),
    "facilities_with_directions": sum(1 for t in fdir if t), "facility_directions_characters": sum(map(len, fdir)),
    "facilities_with_coordinates": sum(1 for f in fac if f["FacilityLatitude"].strip() not in ("", "0", "0.000000")),
    "newest_facility_last_updated": max(f["LastUpdatedDate"] for f in fac),
    "facilities_updated_in_2026": sum(1 for f in fac if f["LastUpdatedDate"].startswith("2026")),
    "campsites": sum(1 for _ in csv.reader(io.TextIOWrapper(z.open("Campsites_API_v1.csv"), encoding="utf-8", errors="replace", newline=""))) - 1,
    "activities": len(read("Activities_API_v1.csv")),
}

BASE = "https://apps.fs.usda.gov/arcx/rest/services/EDW/EDW_RecreationOpportunities_01/MapServer/0"
meta = json.loads(s.get("usfs_meta", BASE + "?f=json"))
count = json.loads(s.get("usfs_count", BASE + "/query?where=1%3D1&returnCountOnly=true&f=json"))["count"]
feats, off = [], 0
while off < count + 2000:
    page = json.loads(s.get("usfs_page_%d" % off, BASE + "/query?where=1%3D1&outFields=recareaid,recareaname,forestname,markeractivitygroup,openstatus,recareadescription&returnGeometry=false&orderByFields=objectid&resultOffset=" + str(off) + "&resultRecordCount=2000&f=json", timeout=300))
    got = [f["attributes"] for f in page.get("features", [])]
    feats += got
    off += 2000
    if len(got) < 2000:
        break
usfs = {}
for f in feats:
    usfs.setdefault(str(f["recareaid"]), f)
ud = [strip(f.get("recareadescription")) for f in usfs.values()]
out["usfs"] = {
    "layer": meta.get("name"), "copyright_text": meta.get("copyrightText"), "max_record_count": meta.get("maxRecordCount"),
    "count_reported": count, "rows_read": len(feats), "distinct_rec_area_ids": len(usfs),
    "distinct_forests": len({f.get("forestname") for f in feats}),
    "by_open_status": dict(collections.Counter(str(f.get("openstatus")) for f in usfs.values()).most_common(8)),
    "by_activity_group": dict(collections.Counter(str(f.get("markeractivitygroup")) for f in feats).most_common(10)),
    "with_description": sum(1 for t in ud if t), "description_characters": sum(map(len, ud)),
}
fs_areas = [a for a in areas if a["ParentOrgID"] == "131" and a["OrgRecAreaID"].strip()]
fs_fac = [f for f in fac if f["OrgFacilityID"] == "131" and f["ParentOrgID"].strip()]
norm = lambda t: re.sub(r"[^a-z0-9]", "", (t or "").lower())
m_areas = [a for a in fs_areas if a["OrgRecAreaID"].strip() in usfs]
m_fac = [f for f in fs_fac if f["ParentOrgID"].strip() in usfs]
out["join_usfs_rec_area_id"] = {
    "ridb_forest_service_rec_areas_with_an_org_id": len(fs_areas), "resolved_in_usfs_layer": len(m_areas),
    "resolved_with_the_same_normalised_name": sum(1 for a in m_areas if norm(a["RecAreaName"]) == norm(usfs[a["OrgRecAreaID"].strip()]["recareaname"])),
    "ridb_forest_service_facilities_with_an_agency_id": len(fs_fac), "facilities_resolved_in_usfs_layer": len(m_fac),
    "facilities_resolved_with_the_same_normalised_name": sum(1 for f in m_fac if norm(f["FacilityName"]) == norm(usfs[f["ParentOrgID"].strip()]["recareaname"])),
    "ridb_forest_service_facilities_total": sum(1 for f in fac if f["OrgFacilityID"] == "131"),
    "usfs_rec_areas_not_cited_by_ridb": len(set(usfs) - {a["OrgRecAreaID"].strip() for a in fs_areas} - {f["ParentOrgID"].strip() for f in fs_fac}),
}
random.seed(20261123)
pick = random.sample(m_fac, min(20, len(m_fac)))
out["handcheck_sample"] = [{"ridb_facility_id": f["FacilityID"], "usfs_rec_area_id": f["ParentOrgID"].strip(), "ridb_name": f["FacilityName"],
                            "usfs_name": usfs[f["ParentOrgID"].strip()]["recareaname"], "usfs_forest": usfs[f["ParentOrgID"].strip()]["forestname"]} for f in pick]
s.write(__file__, out)
