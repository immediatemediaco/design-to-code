Testing:

- Every generated component ships an `index.test.tsx` alongside it, following the same convention as real Patchwork components (see `packages/components/src/atoms/Box/index.test.tsx` for a live example).
- Import the component the same way real component tests do, via the `.jsx` extension alias, not `.tsx`: `import ComponentName from './index.jsx';`.
- Use `@testing-library/react` (`render`, `screen`) and `jest-axe`'s `axe` — both are already set up globally (`toHaveNoViolations` is registered in the shared Jest setup, no need to import or extend it yourself).
- At minimum, every test file must include an accessibility test in this shape:

  ```tsx
  import React from 'react';
  import { render } from '@testing-library/react';
  import { axe } from 'jest-axe';
  import ComponentName from './index.jsx';

  describe('<ComponentName /> component', () => {
    it('passes aXe accessibility checks', async () => {
      const { container } = render(<ComponentName />);

      expect(await axe(container)).toHaveNoViolations();
    });
  });
  ```

- Beyond the required aXe test, add a small number of focused behavioural tests only for things the component actually does (e.g. rendering the designer-provided text content, responding to a prop, an interaction handler firing) — do not fabricate assertions about props or behaviour the component does not have.
- Do not assert on design-token values with raw literal colors; if a behavioural test needs to check an applied color, prefer checking rendered text/structure over asserting computed CSS, since styling lives in `styles.scss` rather than inline styles or component props.
