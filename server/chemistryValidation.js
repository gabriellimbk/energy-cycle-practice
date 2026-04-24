const ARROW_PATTERN = /\s*(?:->|\u2192|\u27F6|\u27F9|=>|=)\s*/;
const STATE_SUFFIX_PATTERN = /\s*\((?:s|l|g|aq)\)\s*$/i;
const SUBSCRIPT_MAP = {
  "\u2080": "0",
  "\u2081": "1",
  "\u2082": "2",
  "\u2083": "3",
  "\u2084": "4",
  "\u2085": "5",
  "\u2086": "6",
  "\u2087": "7",
  "\u2088": "8",
  "\u2089": "9",
};
const SUPERSCRIPT_MAP = {
  "\u2070": "0",
  "\u00B9": "1",
  "\u00B2": "2",
  "\u00B3": "3",
  "\u2074": "4",
  "\u2075": "5",
  "\u2076": "6",
  "\u2077": "7",
  "\u2078": "8",
  "\u2079": "9",
  "\u207A": "+",
  "\u207B": "-",
};
const FRACTION_MAP = {
  "\u00BC": "1/4",
  "\u00BD": "1/2",
  "\u00BE": "3/4",
  "\u2150": "1/7",
  "\u2151": "1/9",
  "\u2152": "1/10",
  "\u2153": "1/3",
  "\u2154": "2/3",
  "\u2155": "1/5",
  "\u2156": "2/5",
  "\u2157": "3/5",
  "\u2158": "4/5",
  "\u2159": "1/6",
  "\u215A": "5/6",
  "\u215B": "1/8",
  "\u215C": "3/8",
  "\u215D": "5/8",
  "\u215E": "7/8",
};

function replaceMappedCharacters(value, characterMap) {
  return Array.from(value).map((character) => characterMap[character] ?? character).join("");
}

export function normalizeEquationText(value) {
  return replaceMappedCharacters(
    replaceMappedCharacters(
      replaceMappedCharacters(String(value ?? ""), SUBSCRIPT_MAP),
      SUPERSCRIPT_MAP
    ),
    FRACTION_MAP
  )
    .replace(/Â¼/g, "1/4")
    .replace(/Â½/g, "1/2")
    .replace(/Â¾/g, "3/4")
    .replace(/[“”]/g, "\"")
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export function hasStateSuffix(value) {
  return STATE_SUFFIX_PATTERN.test(normalizeEquationText(value));
}

export function stripStateSuffix(value) {
  return normalizeEquationText(value).replace(STATE_SUFFIX_PATTERN, "").trim();
}

export function normalizeSpeciesFormula(value) {
  const normalized = stripStateSuffix(value)
    .replace(/^["']|["']$/g, "")
    .replace(/^(\d+(?:\/\d+)?|\d*\.\d+)\s*/, "")
    .replace(/\^?(?:\d[+\-]+|[+\-]+)$/, "")
    .trim();

  const match = normalized.match(/^([A-Za-z(][A-Za-z0-9()]*)$/);
  return match ? match[1] : "";
}

const CHARGE_PLUS_TOKEN = "";
const CHARGE_MINUS_TOKEN = "";

// Hide ion charges before splitting on "+" so that "Mg2+(g) + 2Cl-(g)" doesn't
// get fragmented into ["Mg2", "(g) ", " 2Cl-(g)"]. A charge sign sits immediately
// after a letter/digit/close-paren and is followed by a state symbol, whitespace,
// end-of-string, or another separator.
export function maskCharges(text) {
  return text.replace(
    /([A-Za-z0-9)])(\^?)([+\-])(?=\(|\s|$|,|\n|→|->|=)/g,
    (_, prefix, caret, sign) =>
      prefix + caret + (sign === "+" ? CHARGE_PLUS_TOKEN : CHARGE_MINUS_TOKEN)
  );
}

export function unmaskCharges(text) {
  return text.replace(//g, "+").replace(//g, "-");
}

export function collectSpeciesFromText(value) {
  const normalized = normalizeEquationText(value);
  if (!normalized) {
    return [];
  }

  return maskCharges(normalized)
    .split(/(?:->|\u2192|\u27F6|\u27F9|=>|=|\+|\n|,)/)
    .map((segment) => unmaskCharges(segment).trim())
    .filter(Boolean)
    .map((segment) => {
      if (isAqueousContextToken(segment)) {
        return null;
      }

      const formula = normalizeSpeciesFormula(segment);
      if (!formula) {
        return null;
      }

      return {
        text: segment,
        formula,
        normalizedFormula: formula.toLowerCase(),
        hasStateSymbol: hasStateSuffix(segment),
      };
    })
    .filter(Boolean);
}

export function collectSpeciesFromTexts(values = []) {
  return values.flatMap((value) => collectSpeciesFromText(value));
}

export function stripStandaloneAqueousContext(value) {
  const normalized = normalizeEquationText(value);
  if (!normalized) {
    return "";
  }

  return maskCharges(normalized)
    .split(/(\s*(?:->|\u2192|\u27F6|\u27F9|=>|=)\s*)/)
    .map((part, index) => {
      if (index % 2 === 1) {
        return unmaskCharges(part);
      }

      return part
        .split("+")
        .map((segment) => unmaskCharges(segment).trim())
        .filter((segment) => segment && !isAqueousContextToken(segment))
        .join(" + ");
    })
    .join(" ")
    .replace(/\s+/g, " ")
    .replace(/\s+(?:->|\u2192|\u27F6|\u27F9|=>|=)\s+/g, " -> ")
    .trim();
}

function isAqueousContextToken(value) {
  return /^aq$/i.test(normalizeEquationText(value));
}

function normalizeFormulaForBalance(value) {
  return normalizeEquationText(value)
    .replace(/\((?:aq)\)$/i, "")
    .replace(/\s+/g, "")
    .replace(/(?<=[A-Za-z0-9)\]])(?:\^?[+-]+|\^?\d+[+-]|\^?[+-]\d+)$/g, "")
    .replace(/(?<=[A-Za-z])(?:[+-]+|\d+[+-]|[+-]\d+)$/g, "");
}

function parseCoefficient(rawValue) {
  if (!rawValue) {
    return 1;
  }

  const trimmed = rawValue.trim();
  if (!trimmed) {
    return 1;
  }

  if (trimmed.includes("/")) {
    const [numeratorText, denominatorText] = trimmed.split("/");
    const numerator = Number(numeratorText);
    const denominator = Number(denominatorText);
    if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) {
      throw new Error(`Invalid coefficient: ${rawValue}`);
    }

    return numerator / denominator;
  }

  const numericValue = Number(trimmed);
  if (!Number.isFinite(numericValue)) {
    throw new Error(`Invalid coefficient: ${rawValue}`);
  }

  return numericValue;
}

function mergeCounts(target, source, multiplier = 1) {
  for (const [element, count] of Object.entries(source)) {
    target[element] = (target[element] || 0) + count * multiplier;
  }
}

function parseFormula(formula) {
  let index = 0;

  function parseGroup() {
    const counts = {};

    while (index < formula.length) {
      const character = formula[index];

      if (character === "(") {
        index += 1;
        const nestedCounts = parseGroup();
        let multiplierText = "";

        while (index < formula.length && /\d/.test(formula[index])) {
          multiplierText += formula[index];
          index += 1;
        }

        mergeCounts(counts, nestedCounts, multiplierText ? Number(multiplierText) : 1);
        continue;
      }

      if (character === ")") {
        index += 1;
        return counts;
      }

      if (!/[A-Z]/.test(character)) {
        throw new Error(`Unexpected token "${character}" in formula "${formula}"`);
      }

      let symbol = character;
      index += 1;

      while (index < formula.length && /[a-z]/.test(formula[index])) {
        symbol += formula[index];
        index += 1;
      }

      let quantityText = "";
      while (index < formula.length && /\d/.test(formula[index])) {
        quantityText += formula[index];
        index += 1;
      }

      counts[symbol] = (counts[symbol] || 0) + (quantityText ? Number(quantityText) : 1);
    }

    return counts;
  }

  const counts = parseGroup();
  if (index !== formula.length) {
    throw new Error(`Failed to parse formula "${formula}"`);
  }

  return counts;
}

function parseSpecies(rawSpecies) {
  const trimmed = normalizeEquationText(rawSpecies).replace(/^["']|["']$/g, "").trim();
  if (!trimmed) {
    throw new Error("Empty species");
  }

  if (isAqueousContextToken(trimmed)) {
    return {
      coefficient: 0,
      formula: "aq",
      atoms: {},
    };
  }

  const withoutState = trimmed.replace(STATE_SUFFIX_PATTERN, "").trim();
  const match = withoutState.match(/^(\d+(?:\/\d+)?|\d*\.\d+)?\s*(.+)$/);
  if (!match) {
    throw new Error(`Unable to parse species "${rawSpecies}"`);
  }

  const [, coefficientText, formulaText] = match;
  const normalizedFormula = normalizeFormulaForBalance(formulaText);
  if (!normalizedFormula || /^aq$/i.test(normalizedFormula)) {
    return {
      coefficient: 0,
      formula: normalizedFormula || "aq",
      atoms: {},
    };
  }

  return {
    coefficient: parseCoefficient(coefficientText),
    formula: normalizedFormula,
    atoms: parseFormula(normalizedFormula),
  };
}

function parseEquationSide(rawSide) {
  const counts = {};
  const species = maskCharges(rawSide)
    .split("+")
    .map((part) => unmaskCharges(part).trim())
    .filter(Boolean)
    .map(parseSpecies);

  for (const entry of species) {
    mergeCounts(counts, entry.atoms, entry.coefficient);
  }

  return { counts, species };
}

function getElementDelta(leftCounts, rightCounts) {
  const elements = new Set([...Object.keys(leftCounts), ...Object.keys(rightCounts)]);
  const delta = {};

  for (const element of elements) {
    const difference = (rightCounts[element] || 0) - (leftCounts[element] || 0);
    if (Math.abs(difference) > 1e-9) {
      delta[element] = difference;
    }
  }

  return delta;
}

function formatCount(value) {
  if (Number.isInteger(value)) {
    return String(value);
  }

  return value.toFixed(2).replace(/\.?0+$/, "");
}

function buildMismatchMessage(delta) {
  const fragments = Object.entries(delta).map(([element, difference]) => {
    if (difference > 0) {
      return `${element}: right has ${formatCount(difference)} more`;
    }

    return `${element}: left has ${formatCount(Math.abs(difference))} more`;
  });

  return fragments.join(", ");
}

function classifyEquation(normalizedEquation, sides) {
  if (sides.length !== 2) {
    return {
      status: "unverifiable",
      issue: "Equation must contain one reaction arrow.",
    };
  }

  return null;
}

export function validateExtractedEquations(equations = []) {
  return equations.map((equation) => {
    const normalizedEquation = typeof equation === "string" ? normalizeEquationText(equation) : "";
    if (!normalizedEquation) {
      return {
        equation: normalizedEquation,
        normalizedEquation,
        status: "unverifiable",
        isBalanced: null,
        issue: "No equation was extracted.",
      };
    }

    const sides = normalizedEquation.split(ARROW_PATTERN);
    const classification = classifyEquation(normalizedEquation, sides);
    if (classification) {
      return {
        equation: typeof equation === "string" ? equation.trim() : "",
        normalizedEquation,
        status: classification.status,
        isBalanced: null,
        issue: classification.issue,
      };
    }

    try {
      const left = parseEquationSide(sides[0]);
      const right = parseEquationSide(sides[1]);
      const delta = getElementDelta(left.counts, right.counts);

      if (Object.keys(delta).length === 0) {
        return {
          equation: typeof equation === "string" ? equation.trim() : "",
          normalizedEquation,
          status: "balanced",
          isBalanced: true,
          issue: null,
        };
      }

      return {
        equation: typeof equation === "string" ? equation.trim() : "",
        normalizedEquation,
        status: "unbalanced",
        isBalanced: false,
        issue: `Not balanced. ${buildMismatchMessage(delta)}.`,
      };
    } catch (error) {
      return {
        equation: typeof equation === "string" ? equation.trim() : "",
        normalizedEquation,
        status: "unverifiable",
        isBalanced: null,
        issue: error instanceof Error ? `${error.message}. This extraction may be uncertain rather than chemically wrong.` : "Unable to parse equation.",
      };
    }
  });
}
