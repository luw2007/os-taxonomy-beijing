# Detail Filter Links

## Decision

The graph detail header renders the topic's subject and domain as separate links.

- Subject link preserves `dim` and opens the subject's topic-card list.
- Domain link preserves `dim`, carries both `subject` and `domain`, and opens that domain's topic-card list.
- Links use the existing hash router and retain native link behavior.
- The age badge and any US-visibility badge remain non-navigable.

## Verification

Open a graph detail page, activate each link, and confirm the resulting list title and cards match the selected filter.
