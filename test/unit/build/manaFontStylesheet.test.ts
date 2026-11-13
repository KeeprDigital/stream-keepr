import { describe, expect, it } from 'vitest';
import { trimManaFontStylesheet } from '~~/build/manaFontStylesheet';

const classRules = `.ms {
  display: inline-block;
  font: normal normal normal 14px Mana;
}

.ms-w::before {
  content: "\\e600";
}
`;

// The package's faces bring MPlantin and the legacy formats; its class rules are what the app keeps.
describe('trimManaFontStylesheet', () => {
	it('keeps the class rules and drops every @font-face', () => {
		const css = `@font-face {
  font-family: "Mana";
  src: url("../fonts/mana.eot?v=1.18.0");
  src: url("../fonts/mana.woff?v=1.18.0") format("woff");
}
@font-face {
  font-family: "MPlantin";
  src: url("../fonts/mplantin.woff?v=1.18.0") format("woff");
}
${classRules}`;

		expect(trimManaFontStylesheet(css)).toBe(classRules);
	});
});
