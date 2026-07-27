#!/usr/bin/env node
/**
 * validate-case.mjs — 1EdTech CASE v1.1 CFPackage 的零依赖结构门禁。
 *
 * 本工具覆盖官方 CFPackage schema 的 package 内 required 字段、allowlist、LinkURI
 * 结构和 `precedes` 方向所需的关联字段；不是通用 JSON Schema engine。
 * 官方 schema：https://purl.imsglobal.org/spec/case/v1p1/schema/json/case_v1p1_cfpackage-jsonschema1.json
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ITEM_KEYS = new Set(['identifier', 'fullStatement', 'alternativeLabel', 'CFItemType', 'uri', 'humanCodingScheme', 'listEnumeration', 'abbreviatedStatement', 'conceptKeywords', 'conceptKeywordsURI', 'notes', 'subject', 'subjectURI', 'language', 'educationLevel', 'CFItemTypeURI', 'licenseURI', 'statusStartDate', 'statusEndDate', 'lastChangeDateTime', 'extensions']);
const ASSOCIATION_KEYS = new Set(['identifier', 'associationType', 'sequenceNumber', 'uri', 'originNodeURI', 'destinationNodeURI', 'CFAssociationGroupingURI', 'lastChangeDateTime', 'notes', 'extensions']);
const ASSOCIATION_TYPES = new Set(['isChildOf', 'isPeerOf', 'isPartOf', 'exactMatchOf', 'precedes', 'isRelatedTo', 'replacedBy', 'exemplar', 'hasSkillLevel', 'isTranslationOf']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const requireFields = (value, required, label, errors) => {
  for (const field of required) if (value?.[field] === undefined) errors.push(`${label}.${field}: required`);
};
const checkKeys = (value, allowed, label, errors) => {
  for (const field of Object.keys(value ?? {})) if (!allowed.has(field)) errors.push(`${label}.${field}: not allowed in CFPackage`);
};
const checkLink = (value, label, errors) => {
  requireFields(value, ['identifier', 'uri', 'title'], label, errors);
  if (value?.identifier && !UUID.test(value.identifier)) errors.push(`${label}.identifier: invalid UUID`);
};

export function validateCasePackage(pkg) {
  const errors = [];
  requireFields(pkg, ['CFDocument'], 'CFPackage', errors);
  const doc = pkg?.CFDocument;
  requireFields(doc, ['identifier', 'uri', 'creator', 'title', 'lastChangeDateTime'], 'CFDocument', errors);
  if (doc?.identifier && !UUID.test(doc.identifier)) errors.push('CFDocument.identifier: invalid UUID');
  if (doc?.caseVersion !== '1.1') errors.push('CFDocument.caseVersion: must be 1.1');

  for (const [index, item] of (pkg?.CFItems ?? []).entries()) {
    const label = `CFItems[${index}]`;
    requireFields(item, ['identifier', 'fullStatement', 'uri', 'lastChangeDateTime'], label, errors);
    checkKeys(item, ITEM_KEYS, label, errors);
    if (item?.identifier && !UUID.test(item.identifier)) errors.push(`${label}.identifier: invalid UUID`);
  }
  for (const [index, association] of (pkg?.CFAssociations ?? []).entries()) {
    const label = `CFAssociations[${index}]`;
    requireFields(association, ['identifier', 'associationType', 'uri', 'originNodeURI', 'destinationNodeURI', 'lastChangeDateTime'], label, errors);
    checkKeys(association, ASSOCIATION_KEYS, label, errors);
    if (association?.identifier && !UUID.test(association.identifier)) errors.push(`${label}.identifier: invalid UUID`);
    if (association?.associationType && !ASSOCIATION_TYPES.has(association.associationType) && !association.associationType.startsWith('ext:')) errors.push(`${label}.associationType: invalid CASE v1.1 type`);
    checkLink(association?.originNodeURI, `${label}.originNodeURI`, errors);
    checkLink(association?.destinationNodeURI, `${label}.destinationNodeURI`, errors);
  }
  return errors;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const file = process.argv[2];
  if (!file) throw new Error('用法: node scripts/validate-case.mjs <case-package.json>');
  const errors = validateCasePackage(JSON.parse(readFileSync(resolve(file), 'utf8')));
  if (errors.length) {
    console.error(`✗ CASE v1.1 required-field gate: ${errors.length} problem(s)`);
    for (const error of errors) console.error(`  - ${error}`);
    process.exit(1);
  }
  console.log('✓ CASE v1.1 required-field gate passed');
}
