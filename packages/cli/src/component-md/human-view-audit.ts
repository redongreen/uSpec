import type { CanonicalComponentContract } from './types.js';

type JsonObject = Record<string, any>;

function requireText(markdown: string, value: unknown, label: string, errors: string[]): void {
  const text = String(value ?? '').trim();
  if (text && !markdown.includes(text)) errors.push(`${label} is missing: ${text}`);
}

function walkTree(node: JsonObject | null, visit: (node: JsonObject) => void): void {
  if (!node) return;
  visit(node);
  for (const child of node.children ?? []) walkTree(child, visit);
}

export function auditHumanView(
  markdown: string,
  contract: CanonicalComponentContract,
): string[] {
  const errors: string[] = [];
  for (const heading of [
    '## Overview',
    '## Composition',
    '## Anatomy',
    '## Implementation invariants',
    '## API',
    '## Structure',
    '## Color',
    '## Accessibility',
    '## Known gaps',
    '## Evidence coverage',
  ]) {
    if (!markdown.includes(heading)) errors.push(`required section is missing: ${heading}`);
  }

  for (const property of contract.api.mainTable?.properties ?? []) {
    requireText(markdown, property.property, 'API property', errors);
  }
  for (const subcomponent of contract.api.subComponentTables ?? []) {
    requireText(markdown, subcomponent.name, 'API sub-component', errors);
  }
  for (const example of contract.api.configurationExamples ?? []) {
    requireText(markdown, example.title, 'configuration example', errors);
  }

  walkTree(contract.anatomy.defaultTree as JsonObject | null, (node) =>
    requireText(markdown, node.name, 'anatomy node', errors),
  );
  for (const section of contract.structure.sections ?? []) {
    requireText(markdown, section.sectionName, 'structure section', errors);
    for (const row of section.rows ?? []) {
      if (row.isSubProperty !== true) requireText(markdown, row.spec, 'structure group', errors);
    }
  }

  const colorGroups = contract.color.variants ?? contract.color.sections ?? [];
  for (const group of colorGroups) {
    requireText(
      markdown,
      group.name ?? group.sectionName,
      'color context',
      errors,
    );
  }

  requireText(
    markdown,
    String(contract.accessibility.guidelines ?? '').split('\n')[0],
    'accessibility guidance',
    errors,
  );
  for (const state of contract.accessibility.states ?? []) {
    requireText(markdown, state.state, 'accessibility state', errors);
    for (const section of state.sections ?? []) {
      requireText(markdown, section.title, 'accessibility platform', errors);
    }
  }

  return [...new Set(errors)];
}
