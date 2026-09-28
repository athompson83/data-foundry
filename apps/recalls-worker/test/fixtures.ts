/** Verbatim source records shared by the Worker tests. */

export const FOOD = {
  recall_number: 'F-0001-2026',
  event_id: '90001',
  status: 'Ongoing',
  classification: 'Class I',
  product_type: 'Food',
  recalling_firm: 'Acme Snacks LLC',
  city: 'Austin',
  state: 'TX',
  country: 'United States',
  voluntary_mandated: 'Voluntary: Firm initiated',
  distribution_pattern: 'Distributed to retailers in TX, OK and LA.',
  product_description: 'Acme Peanut Crunch Bars, 2 oz, UPC 0 12345 67890 5',
  product_quantity: '1,200 cases',
  reason_for_recall: 'Product contains undeclared peanuts.',
  recall_initiation_date: '20260901',
  report_date: '20260915',
  code_info: 'Lot #: AC2601, Best By 03/01/2027; AC2602, Best By 03/08/2027',
};

export const DEVICE = {
  recall_number: 'Z-0002-2026',
  event_id: '90002',
  status: 'Ongoing',
  classification: 'Class II',
  recalling_firm: 'Medi Devices Inc',
  distribution_pattern: 'US Nationwide distribution.',
  product_description: 'Infusion set',
  product_quantity: '3618',
  reason_for_recall: 'Software anomaly may cause an occlusion alarm to fail.',
  report_date: '20260910',
  code_info: 'UDI/DI 05708932072526, Lot Numbers: 8849570, 8904168',
};


// Verbatim source records (CPSC Recall API and Health Canada open data), retrieved 2026-09-27.
export const CPSC = {
  RecallID: 10220,
  RecallNumber: '25203',
  RecallDate: '2025-04-03T00:00:00',
  Description:
    'This recall involves DEWALT 70,000 BTU outdoor portable cordless forced air propane heaters model number DXH70CFAVX. The heaters are yellow and black. The model number is located on the hang tag. "DEWALT" is printed in black on the side of the bottom yellow portion of the units. ',
  URL: 'https://www.cpsc.gov/Recalls/2025/Enerco-Recalls-DEWALT-70000-BTU-Outdoor-Portable-Cordless-Forced-Air-Propane-Heaters-Due-to-Fire-and-Burn-Hazards-Sold-Exclusively-at-Lowes',
  Title: "Enerco Recalls DEWALT 70,000 BTU Outdoor Portable Cordless Forced Air Propane Heaters Due to Fire and Burn Hazards; Sold Exclusively at Lowe's",
  ConsumerContact: 'Enerco toll-free at 800-964-4328',
  LastPublishDate: '2025-04-03T00:00:00',
  Products: [{ Name: 'DEWALT 70,000 BTU Outdoor Portable Cordless Forced Air Propane Heaters', Description: '', Model: '', Type: '', CategoryID: '', NumberOfUnits: 'About 21,250 (In addition, about 500 were sold in Canada)' }],
  Inconjunctions: [{ URL: 'https://recalls-rappels.canada.ca/en/alert-recall/dewalt-70000-btu-outdoor-portable-cordless-forced-air-propane-heater-recalled-due-fire' }],
  Images: [{ URL: 'https://cpsc.gov/s3fs-public/heater.jpg', Caption: 'Recalled heater' }],
  Injuries: [{ Name: 'The firm has received 11 reports of overheating. No injuries have been reported.' }],
  Manufacturers: [],
  Retailers: [{ Name: "Lowe's stores nationwide and online at Lowes.com from May 2024 through January 2025 for about $200.", CompanyID: '' }],
  Importers: [{ Name: 'Enerco Group Inc., of Cleveland, Ohio', CompanyID: '' }],
  Distributors: [],
  SoldAtLabel: null,
  ManufacturerCountries: [{ Country: 'China' }],
  ProductUPCs: [{ UPC: '089301008588' }],
  Hazards: [
    {
      Name: "The recalled portable heaters' operating instructions can cause consumers to incorrectly depress the start button too quickly and prevent the fan from starting, causing the heaters to overheat, posing fire and burn hazards.",
      HazardType: '',
      HazardTypeID: '',
    },
  ],
  Remedies: [{ Name: 'Consumers should immediately stop using the recalled heaters and contact Enerco to request new instructions and a warning sticker describing how to start the heater using the power button.' }],
  RemedyOptions: [{ Option: 'Repair' }],
};

export const HC = {
  NID: '77184',
  Title: 'DeWalt 70,000-BTU Outdoor Portable Cordless Forced Air Propane Heater recalled due to fire hazard ',
  URL: 'https://recalls-rappels.canada.ca/en/alert-recall/dewalt-70000-btu-outdoor-portable-cordless-forced-air-propane-heater-recalled-due-fire',
  Organization: 'Consumer product safety',
  Product: 'DeWalt 70,000-BTU Outdoor Portable Cordless Forced Air Propane Heater',
  Issue: 'Fire hazard',
  'What you should do':
    'Consumers should immediately stop using the recalled product.For more information, consumers can contact Enerco Group by telephone at 1-800-964-4328.Joint recall with Health Canada, the United States Consumer Product Safety Commission (US CPSC) and Enerco Group.Please note that the Canada Consumer Product Safety Act prohibits recalled products from being redistributed.',
  Category: 'Outdoor living',
  'Recall class': '',
  'Last updated': '2025-04-03',
  Archived: '0',
};

export const HC_ONLY = { ...HC, NID: '82659', Title: "Make Believe Ideas Groovy Baby 'I Spy a Fly!' board book recalled due to choking hazard", URL: 'https://recalls-rappels.canada.ca/en/alert-recall/make-believe-ideas-groovy-baby-spy-fly-board-book-recalled-due-choking-hazard', Product: "Make Believe Ideas Groovy Baby 'I Spy a Fly!' board book", Issue: 'Choking hazard', Category: 'Toys and games', 'What you should do': '', 'Last updated': '2026-09-22' };
export const MEDICAL = { ...HC, NID: '82681', Organization: 'Medical devices', Title: 'PERMA-HAND Silk Suture' };
