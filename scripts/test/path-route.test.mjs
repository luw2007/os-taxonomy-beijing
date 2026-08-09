#!/usr/bin/env node
import assert from 'node:assert/strict';
import test from 'node:test';
import { buildRoute, parseRoute } from '../../viewer/path-route.js';

test('parses the complete single-route workspace contract', () => {
  assert.deepEqual(parseRoute('#/mt_KJeEeTutJI?tab=graph&dim=bj-primary&subject=Mathematics&domain=Geometry&ageRange=8-8&q=%E5%88%86%E6%95%B0'), {
    id: 'mt_KJeEeTutJI', tab: 'graph', dim: 'bj-primary', subject: 'Mathematics',
    domain: 'Geometry', ageRange: '8-8', q: '分数',
  });
});

test('defaults invalid tabs to path and permits subject without domain', () => {
  assert.deepEqual(parseRoute('#/?tab=other&subject=Mathematics'), {
    id: null, tab: 'path', dim: null, subject: 'Mathematics', domain: null, ageRange: null, q: null,
  });
});

test('drops a domain that has no subject', () => {
  assert.deepEqual(parseRoute('#/?domain=Geometry'), {
    id: null, tab: 'path', dim: null, subject: null, domain: null, ageRange: null, q: null,
  });
});

test('buildRoute preserves context while switching tabs and never emits query id', () => {
  const current = parseRoute('#/mt_KJeEeTutJI?dim=bj-primary&subject=Mathematics&domain=Geometry&ageRange=8-8&q=%E5%88%86%E6%95%B0');
  const hash = buildRoute({ tab: 'graph' }, current);
  assert.equal(hash, '#/mt_KJeEeTutJI?tab=graph&dim=bj-primary&subject=Mathematics&domain=Geometry&ageRange=8-8&q=%E5%88%86%E6%95%B0');
  assert.doesNotMatch(hash, /[?&]id=/);
  assert.deepEqual(parseRoute(hash), { ...current, tab: 'graph' });
});

test('subject selection clears domain and dimension selection clears unreliable filters', () => {
  const current = parseRoute('#/mt_KJeEeTutJI?tab=graph&dim=us&subject=Mathematics&domain=Geometry&ageRange=8-8&q=x');
  assert.equal(buildRoute({ subject: 'Science', domain: null }, current), '#/mt_KJeEeTutJI?tab=graph&dim=us&subject=Science&ageRange=8-8&q=x');
  assert.equal(buildRoute({ dim: 'bj-primary', subject: null, domain: null, q: null }, current), '#/mt_KJeEeTutJI?tab=graph&dim=bj-primary&ageRange=8-8');
});

test('preserves the textbook comparison route and its filters', () => {
  const route = parseRoute('#/textbook-gaps?tab=graph&dim=us&subject=Mathematics&gap_type=missing&grade=一年级上&q=%E5%88%86%E6%95%B0');
  assert.deepEqual(route, {
    id: null, tab: 'graph', dim: 'us', subject: 'Mathematics', domain: null,
    ageRange: null, q: '分数', view: 'textbook-gaps', gapType: 'missing', grade: '一年级上',
  });
  assert.equal(buildRoute({ q: '图形' }, route), '#/textbook-gaps?tab=graph&dim=us&subject=Mathematics&q=%E5%9B%BE%E5%BD%A2&gap_type=missing&grade=%E4%B8%80%E5%B9%B4%E7%BA%A7%E4%B8%8A');
});
