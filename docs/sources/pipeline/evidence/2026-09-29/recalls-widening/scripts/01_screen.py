import sys, json; sys.path.insert(0,'.'); sys.path.insert(0,'scripts')
from common import *
out = {}
def probe(name, url, save=None, binary=False):
    b, st = get(url, retries=2, timeout=60, binary=binary)
    out[name] = {"url": url, "status": st, "bytes": len(b) if b else 0}
    if b and save: open(os.path.join(RAW, save), "wb" if binary else "w").write(b)
    print(name, st, len(b) if b else 0, flush=True); return b
eu = probe("eu_report_list", "https://ec.europa.eu/safety-gate-alerts/api/download/weeklyReport/list/xml/en", "eu_report_list.xml")
probe("eu_dcat", "https://data.europa.eu/api/hub/search/datasets/rapex-rapid-alert-system-non-food", "eu_dataset_meta.json")
probe("uk_search_1", "https://www.gov.uk/api/search.json?filter_format=product_safety_alert_report_recall&count=1&order=-public_timestamp", "uk_search_1.json")
probe("uk_terms", "https://www.gov.uk/help/terms-conditions", "uk_terms.html")
probe("hc_pkg", "https://open.canada.ca/data/api/action/package_show?id=d38de914-c94c-429b-8ab1-8776c31643e3", "hc_package.json")
probe("cpsc_2025", "https://www.saferproducts.gov/RestWebServices/Recall?format=json&RecallDateStart=2025-01-01", "cpsc_since_2025.json")
probe("accc_rss", "https://www.productsafety.gov.au/rss/feed.xml/psa_recall", "accc_rss.xml")
probe("accc_search", "https://www.productsafety.gov.au/search-consumer-product-recalls", "accc_search.html")
probe("accc_copyright", "https://www.productsafety.gov.au/about-us/using-our-website/disclaimer-and-copyright", "accc_copyright.html")
probe("nz_sitemap", "https://www.productsafety.govt.nz/sitemap.xml", "nz_sitemap.xml")
probe("nz_copyright", "https://www.productsafety.govt.nz/about-us/copyright", "nz_copyright.html")
probe("fsis_api", "https://www.fsis.usda.gov/fsis/api/recall/v/1", "fsis_api.json")
probe("fsis_page", "https://www.fsis.usda.gov/recalls", None)
json.dump(out, open("results/01_screen.json","w"), indent=1)
