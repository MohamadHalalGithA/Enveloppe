import { z } from "zod";

/** Civil date with no time or zone: "YYYY-MM-DD". "Today" is always computed in America/Toronto. */
export const CivilDateZ = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");
export type CivilDate = z.infer<typeof CivilDateZ>;

/** Bounding box [ymin, xmin, ymax, xmax] normalized 0–1000 over the sanitized image (Gemini convention). */
export const BoxZ = z.tuple([
  z.number().min(0).max(1000),
  z.number().min(0).max(1000),
  z.number().min(0).max(1000),
  z.number().min(0).max(1000),
]);
export type Box = z.infer<typeof BoxZ>;

export const AgencyCodeZ = z.enum([
  "CRA",
  "IRCC",
  "SERVICEONTARIO",
  "CITY_OF_OTTAWA",
  "OTHER_GOVERNMENT",
  "NON_GOVERNMENT",
  "UNKNOWN",
]);
export type AgencyCode = z.infer<typeof AgencyCodeZ>;

export const DocTypeZ = z.enum([
  "CRA_REVIEW_DOCUMENT_REQUEST",
  "CRA_NOTICE_OF_ASSESSMENT",
  "CRA_NOTICE_OF_REASSESSMENT",
  "CRA_BALANCE_DUE",
  "IRCC_BIOMETRICS_INSTRUCTION",
  "IRCC_ACKNOWLEDGEMENT_OF_RECEIPT",
  "IRCC_DOCUMENT_REQUEST",
  "SERVICEONTARIO_RENEWAL",
  "CITY_PROPERTY_TAX",
  "CITY_PARKING_TICKET",
  "OTHER",
]);
export type DocType = z.infer<typeof DocTypeZ>;

export const ActionTypeZ = z.enum([
  "submit_documents",
  "give_biometrics",
  "pay",
  "call",
  "file_objection",
  "visit",
  "none",
  "other",
]);
export type ActionType = z.infer<typeof ActionTypeZ>;

export const PaymentMethodZ = z.enum([
  "interac_etransfer",
  "gift_card",
  "crypto",
  "prepaid_card",
  "wire",
  "online_banking",
  "debit_my_payment",
  "credit_card_third_party",
  "pre_authorized_debit",
  "cheque",
  "in_person",
  "other",
]);
export type PaymentMethod = z.infer<typeof PaymentMethodZ>;

/** Registry ids look like "tel-cra-benefits", "dom-canada-ca", "src-cra-contact". */
export const RegistryIdZ = z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/);
