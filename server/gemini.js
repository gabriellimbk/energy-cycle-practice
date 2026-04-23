import { GoogleGenAI, Type } from "@google/genai";
import { collectSpeciesFromText, collectSpeciesFromTexts, maskCharges, normalizeEquationText, stripStandaloneAqueousContext, unmaskCharges, validateExtractedEquations } from "./chemistryValidation.js";

const ARROW_CONNECTION_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    fromNode: { type: Type.STRING, description: "Exact text of the node where the arrow starts (the tail end, NOT the arrowhead end)." },
    toNode: { type: Type.STRING, description: "Exact text of the node where the arrow ends (the arrowhead/pointed end)." },
    label: { type: Type.STRING, description: "Visible arrow label such as ΔH, -3267, 6(-394), or blank if none is visible." },
    labelStatus: { type: Type.STRING, description: "One of: correct, incorrect, missing. Compare only the visible numeric value(s) in the label against the reference data table provided. Use 'missing' if no label is written. Use 'correct' if each numeric component in the label appears in the reference data (treat +1 and -1 both as matching a reference value of 1 or -1 — the absolute value must match; ignore the sign entirely). Use 'correct' for expressions like '4(-394) + 4(-286)' if the component values appear in the reference data. Use 'incorrect' only if a numeric label is present but its value cannot be found in the reference data at all. Do NOT re-derive what the correct sign should be from arrow direction or from chemistry context — only compare the written number against the table." }
  },
  required: ["fromNode", "toNode", "label", "labelStatus"]
};

const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    score: { type: Type.NUMBER, description: "A score out of 10 for the student's work." },
    comments: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: "Specific feedback points based on the marking checklist. Do NOT include general comments about the energy cycle being well-drawn, complete, or clearly laid out — that is handled separately."
    },
    hessLawApplication: {
      type: Type.STRING,
      description: "Explanation of how successfully the Hess's Law mathematical calculation was applied."
    },
    energyCycleStatus: {
      type: Type.STRING,
      description: "One of: complete, incomplete. Complete means all required nodes and connecting arrows are present. Incomplete means the cycle is structurally missing essential elements."
    },
    hessLawStatus: {
      type: Type.STRING,
      description: "One of: correct, incorrect, missing. Based only on the written mathematical Hess's Law calculation, not on the cycle diagram."
    },
    deltaHCalculationStatus: {
      type: Type.STRING,
      description: "One of: correct, incorrect, missing. Based solely on whether a final numerical ΔH value is written anywhere and whether it matches the expected value. Do not consider cycle structure."
    },
    extractedEquations: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: "Any explicit full reaction equations written in the student's diagram."
    },
    extractedNodeLabels: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: "Standalone Hess-cycle node labels or energy-level labels written in the student's diagram."
    },
    arrowConnections: {
      type: Type.ARRAY,
      items: ARROW_CONNECTION_SCHEMA,
      description: "Arrow connections in the Hess cycle, mapping visible start node, end node, and arrow label."
    },
    extractionNotes: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: "Short notes describing unclear handwriting or uncertain tokens without correcting them."
    }
  },
  required: ["score", "comments", "hessLawApplication", "energyCycleStatus", "hessLawStatus", "deltaHCalculationStatus", "extractedEquations", "extractedNodeLabels", "arrowConnections", "extractionNotes"]
};

function getGeminiClient() {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    throw new Error("Missing GEMINI_API_KEY.");
  }

  return new GoogleGenAI({ apiKey });
}

function getGeminiModel() {
  return process.env.GEMINI_MODEL || "gemini-2.5-flash";
}

function normalizeStringArray(value) {
  return Array.isArray(value) ? value.filter((entry) => typeof entry === "string") : [];
}

function normalizeBinaryStatus(value) {
  if (typeof value !== "string") {
    return "";
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === "complete" || normalized === "incomplete") {
    return normalized;
  }

  return "";
}

function normalizeTernaryStatus(value) {
  if (typeof value !== "string") {
    return "";
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === "correct" || normalized === "incorrect" || normalized === "missing") {
    return normalized;
  }

  return "";
}

function normalizeSummaryStatus(value) {
  if (typeof value !== "string") {
    return "uncertain";
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === "correct" || normalized === "incorrect" || normalized === "missing") {
    return normalized;
  }

  if (normalized === "complete" || normalized === "incomplete") {
    return normalized;
  }

  return "uncertain";
}

function normalizeArrowConnections(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((entry) => entry && typeof entry === "object")
    .map((entry) => ({
      fromNode: typeof entry.fromNode === "string" ? entry.fromNode.trim() : "",
      toNode: typeof entry.toNode === "string" ? entry.toNode.trim() : "",
      label: typeof entry.label === "string" ? entry.label.trim() : "",
      labelStatus: normalizeTernaryStatus(entry.labelStatus),
    }))
    .filter((entry) => entry.fromNode && entry.toNode);
}

function combineArrowLabels(labels) {
  const normalizedLabels = labels
    .map((label) => (typeof label === "string" ? label.trim() : ""))
    .filter(Boolean);

  if (normalizedLabels.length === 0) {
    return "";
  }

  return normalizedLabels.join(" + ");
}

function isMissingLabel(label) {
  if (typeof label !== "string") {
    return true;
  }

  const normalized = label.trim().toLowerCase();
  return !normalized || normalized === "blank" || normalized === "none" || normalized === "unlabelled" || normalized === "unlabeled";
}

function isFloatingNodeFragment(label, existingNodes) {
  if (typeof label !== "string") {
    return false;
  }

  const normalized = label.trim();
  if (!normalized) {
    return false;
  }

  if (existingNodes.some((node) => node.includes(normalized))) {
    return false;
  }

  if (normalized.includes("+") || normalized.includes("->") || normalized.includes("???")) {
    return false;
  }

  if (/[A-Z][a-z]?\d*\([^)]*\)/.test(normalized)) {
    return false;
  }

  return /^\([a-z]{1,3}\)$/i.test(normalized) || /^\d+(?:\/\d+)?$/.test(normalized);
}

function appendNodeFragment(node, fragment) {
  const trimmedNode = node.trim();
  const trimmedFragment = fragment.trim();

  if (!trimmedFragment || trimmedNode.includes(trimmedFragment)) {
    return trimmedNode;
  }

  return `${trimmedNode} ${trimmedFragment}`.replace(/\s+/g, " ").trim();
}

function stripInlineOxygenAnnotation(value) {
  if (typeof value !== "string") {
    return "";
  }

  return value
    .replace(/\s*\+\s*\d+(?:\/\d+)?\s*O(?:2|\u2082)\(g\)\s*$/gi, "")
    .replace(/^\s*\+\s*\d+(?:\/\d+)?\s*O(?:2|\u2082)\(g\)\s*/gi, "")
    .trim();
}

function sanitizeNodeLabel(value) {
  if (typeof value !== "string") {
    return "";
  }

  return value
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function getExplicitStateMap(text) {
  const states = new Map();

  for (const species of collectSpeciesFromText(text)) {
    const match = normalizeEquationText(species.text).match(/\((s|l|g|aq)\)\s*$/i);
    if (match) {
      states.set(species.normalizedFormula, match[1].toLowerCase());
    }
  }

  return states;
}

function hasSharedExplicitStateConflict(observedText, candidateText) {
  const observedStates = getExplicitStateMap(observedText);
  if (observedStates.size === 0) {
    return false;
  }

  const candidateStates = getExplicitStateMap(candidateText);
  for (const [formula, observedState] of observedStates.entries()) {
    const candidateState = candidateStates.get(formula);
    if (candidateState && candidateState !== observedState) {
      return true;
    }
  }

  return false;
}

function normalizeComparableChemistryText(value) {
  if (typeof value !== "string") {
    return "";
  }

  return stripStandaloneAqueousContext(value)
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[â†’→]/g, "->")
    .replace(/[()]/g, (char) => char)
    .trim();
}

function getQuestionReferenceTexts(question) {
  const texts = [question?.data?.reaction || ""];

  for (const row of question?.data?.table || []) {
    if (typeof row?.equation === "string") {
      texts.push(row.equation);
    }
  }

  return texts.filter(Boolean);
}

function dedupeStrings(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function evaluateStateSymbols(question, extractedEquations, extractedNodeLabels, arrowConnections, lowConfidenceExtraction) {
  const expectedSpecies = collectSpeciesFromTexts(getQuestionReferenceTexts(question));
  const observedSpecies = collectSpeciesFromTexts([
    ...extractedEquations,
    ...extractedNodeLabels,
    ...arrowConnections.flatMap((connection) => [connection.fromNode, connection.toNode]),
  ]);

  const expectedByFormula = new Map();
  for (const entry of expectedSpecies) {
    if (!expectedByFormula.has(entry.normalizedFormula)) {
      expectedByFormula.set(entry.normalizedFormula, entry.formula);
    }
  }

  const stateEvidenceSpecies = [];
  const missingStateSpecies = [];
  let unseenCount = 0;

  for (const [normalizedFormula, formula] of expectedByFormula.entries()) {
    const matches = observedSpecies.filter((entry) => entry.normalizedFormula === normalizedFormula);
    if (matches.some((entry) => entry.hasStateSymbol)) {
      stateEvidenceSpecies.push(formula);
      continue;
    }

    if (matches.length > 0) {
      missingStateSpecies.push(formula);
      continue;
    }

    unseenCount += 1;
  }

  let status = "uncertain";
  if (missingStateSpecies.length > 0) {
    status = lowConfidenceExtraction ? "uncertain" : "incorrect";
  } else if (expectedByFormula.size > 0 && unseenCount === 0) {
    status = "correct";
  }

  return {
    status,
    missingStateSpecies: dedupeStrings(missingStateSpecies),
    stateEvidenceSpecies: dedupeStrings(stateEvidenceSpecies),
  };
}

function splitReactionSides(reaction) {
  if (typeof reaction !== "string") {
    return null;
  }

  const sides = stripStandaloneAqueousContext(reaction).split(/\s*(?:->|\u2192|\u27F6|\u27F9|=>|=)\s*/);
  if (sides.length !== 2) {
    return null;
  }

  return {
    left: sides[0].trim(),
    right: sides[1].trim(),
  };
}

function getQuestionReferenceNodes(question) {
  const nodes = [];
  const seen = new Set();

  const pushNode = (value) => {
    if (typeof value !== "string") {
      return;
    }

    const trimmed = value.trim();
    if (!trimmed) {
      return;
    }

    const key = normalizeComparableChemistryText(trimmed);
    if (!key || seen.has(key)) {
      return;
    }

    seen.add(key);
    nodes.push(trimmed);
  };

  const targetReaction = splitReactionSides(question?.data?.reaction);
  if (targetReaction) {
    pushNode(targetReaction.left);
    pushNode(targetReaction.right);
  }

  for (const row of question?.data?.table || []) {
    const rowReaction = splitReactionSides(row?.equation);
    if (!rowReaction) {
      continue;
    }

    pushNode(rowReaction.left);
    pushNode(rowReaction.right);
  }

  return {
    nodes,
    targetReaction,
  };
}

function normalizeForStateStripSnap(comparable) {
  // Normalize Unicode subscripts to ASCII then strip state symbols.
  // Used to snap node text that differs from the reference only by state symbols.
  const subscriptMap = {"₀":"0","₁":"1","₂":"2","₃":"3","₄":"4","₅":"5","₆":"6","₇":"7","₈":"8","₉":"9"};
  return stripStandaloneAqueousContext(Array.from(comparable)
    .map((c) => subscriptMap[c] ?? c)
    .join(""))
    .replace(/\((?:s|l|g|aq)\)/gi, "")
    .replace(/\s+/g, "");
}

function snapToReferenceNode(value, referenceNodes) {
  const sanitized = sanitizeNodeLabel(value);
  const comparable = normalizeComparableChemistryText(sanitized);
  if (!comparable) {
    return sanitized;
  }

  const exactMatches = [];
  const strippedMatches = [];
  const strippedComparable = normalizeForStateStripSnap(comparable);

  for (const candidate of referenceNodes) {
    const candidateComparable = normalizeComparableChemistryText(candidate);
    if (!candidateComparable) {
      continue;
    }

    if (comparable === candidateComparable) {
      exactMatches.push(candidate);
      continue;
    }

    const strippedCandidateComparable = normalizeForStateStripSnap(candidateComparable);
    if (
      strippedComparable &&
      strippedCandidateComparable &&
      strippedComparable === strippedCandidateComparable &&
      !hasSharedExplicitStateConflict(sanitized, candidate)
    ) {
      strippedMatches.push(candidate);
    }
  }

  if (exactMatches.length > 0) {
    return exactMatches[0];
  }

  if (strippedMatches.length === 1) {
    return strippedMatches[0];
  }

  return sanitized;
}

function isTrivialNodeLabel(value) {
  if (typeof value !== "string") {
    return true;
  }

  const normalized = value.trim();
  return !normalized || /^[\d\s()+\-/.]+$/.test(normalized);
}

function getCommonIntermediateNode(referenceNodes, extractedNodeLabels, arrowConnections) {
  const referenceKeys = new Set(referenceNodes.map((node) => normalizeComparableChemistryText(node)));
  const candidates = new Map();

  const noteCandidate = (value) => {
    const sanitized = sanitizeNodeLabel(value);
    const comparable = normalizeComparableChemistryText(sanitized);
    if (!sanitized || !comparable || referenceKeys.has(comparable) || isTrivialNodeLabel(sanitized)) {
      return;
    }

    const existing = candidates.get(sanitized) || { count: 0, length: sanitized.length };
    existing.count += 1;
    candidates.set(sanitized, existing);
  };

  for (const label of extractedNodeLabels || []) {
    noteCandidate(label);
  }

  for (const connection of arrowConnections || []) {
    noteCandidate(connection.fromNode);
    noteCandidate(connection.toNode);
  }

  const ranked = Array.from(candidates.entries()).sort((left, right) => {
    const leftScore = left[1].count * 100 + left[1].length;
    const rightScore = right[1].count * 100 + right[1].length;
    return rightScore - leftScore;
  });

  return ranked[0]?.[0] || "";
}

function formatOxygenCoefficient(oxygenAtoms) {
  const molecules = oxygenAtoms / 2;
  if (Number.isInteger(molecules)) {
    return String(molecules);
  }

  if (Number.isInteger(oxygenAtoms)) {
    return `${oxygenAtoms}/2`;
  }

  return molecules.toFixed(2).replace(/\.?0+$/, "");
}

function completeOxygenOnlyEquation(equation) {
  if (typeof equation !== "string" || !equation.trim()) {
    return equation;
  }

  const [check] = validateExtractedEquations([equation]);
  if (!check || check.status !== "unbalanced" || typeof check.issue !== "string") {
    return equation;
  }

  const match = check.issue.match(/^Not balanced\. O: (right|left) has ([\d.]+) more\.$/);
  if (!match) {
    return equation;
  }

  const oxygenAtoms = Number(match[2]);
  if (!Number.isFinite(oxygenAtoms) || oxygenAtoms <= 0) {
    return equation;
  }

  const oxygenTerm = `${formatOxygenCoefficient(oxygenAtoms)}O2(g)`;
  const sides = equation.split(/\s*(?:->|\u2192|\u27F6|\u27F9|=>|=)\s*/);
  if (sides.length !== 2) {
    return equation;
  }

  if (match[1] === "right") {
    return `${sides[0].trim()} + ${oxygenTerm} -> ${sides[1].trim()}`;
  }

  return `${sides[0].trim()} -> ${sides[1].trim()} + ${oxygenTerm}`;
}

function scoreEquationStatuses(checks) {
  return checks.reduce((score, check) => {
    if (check.status === "balanced") return score + 3;
    if (check.status === "ignored") return score + 1;
    if (check.status === "unverifiable") return score - 1;
    if (check.status === "unbalanced") return score - 4;
    return score;
  }, 0);
}

function optimizeNodeFragments(reconstructedFromArrows, extractedNodeLabels) {
  if (reconstructedFromArrows.length === 0) {
    return reconstructedFromArrows;
  }

  const uniqueNodes = Array.from(new Set(
    reconstructedFromArrows.flatMap((entry) => [entry.fromNode, entry.toNode]).filter(Boolean)
  ));
  const floatingFragments = extractedNodeLabels.filter((label) => isFloatingNodeFragment(label, uniqueNodes));

  if (floatingFragments.length === 0 || uniqueNodes.length === 0) {
    return reconstructedFromArrows;
  }

  let bestEntries = reconstructedFromArrows;
  let bestScore = scoreEquationStatuses(validateExtractedEquations(reconstructedFromArrows.map((entry) => entry.equation)));
  let bestAttachmentCount = 0;
  const totalBits = floatingFragments.length * uniqueNodes.length;
  const maxMasks = totalBits > 20 ? 1 << 20 : 1 << totalBits;

  for (let mask = 0; mask < maxMasks; mask += 1) {
    const augmentedNodes = new Map(uniqueNodes.map((node) => [node, node]));
    let attachmentCount = 0;

    for (let fragmentIndex = 0; fragmentIndex < floatingFragments.length; fragmentIndex += 1) {
      const fragment = floatingFragments[fragmentIndex];

      for (let nodeIndex = 0; nodeIndex < uniqueNodes.length; nodeIndex += 1) {
        const bitIndex = fragmentIndex * uniqueNodes.length + nodeIndex;
        if (bitIndex >= 31) {
          continue;
        }

        if ((mask & (1 << bitIndex)) !== 0) {
          const node = uniqueNodes[nodeIndex];
          augmentedNodes.set(node, appendNodeFragment(augmentedNodes.get(node) || node, fragment));
          attachmentCount += 1;
        }
      }
    }

    const candidateEntries = reconstructedFromArrows.map((entry) => {
      const nextFromNode = augmentedNodes.get(entry.fromNode) || entry.fromNode;
      const nextToNode = augmentedNodes.get(entry.toNode) || entry.toNode;

      return {
        ...entry,
        fromNode: nextFromNode,
        toNode: nextToNode,
        equation: `${nextFromNode} -> ${nextToNode}`,
      };
    });

    const candidateChecks = validateExtractedEquations(candidateEntries.map((entry) => entry.equation));
    const candidateScore = scoreEquationStatuses(candidateChecks);

    if (
      candidateScore > bestScore ||
      (candidateScore === bestScore && attachmentCount > 0 && attachmentCount < bestAttachmentCount)
    ) {
      bestEntries = candidateEntries;
      bestScore = candidateScore;
      bestAttachmentCount = attachmentCount;
    }
  }

  return bestEntries;
}

function mergeDirectionalArrowEntries(entries) {
  const mergedByDirection = new Map();

  for (const entry of entries) {
    const directionKey = `${normalizeComparableChemistryText(entry.fromNode)}=>${normalizeComparableChemistryText(entry.toNode)}`;
    const existing = mergedByDirection.get(directionKey);

    if (!existing) {
      mergedByDirection.set(directionKey, {
        ...entry,
        labels: [entry.label],
        statuses: [entry.labelStatus || ""],
        hasMissingLabel: entry.hasCompleteLabel === false || isMissingLabel(entry.label),
      });
      continue;
    }

    existing.labels.push(entry.label);
    existing.statuses.push(entry.labelStatus || "");
    existing.hasMissingLabel = existing.hasMissingLabel || entry.hasCompleteLabel === false || isMissingLabel(entry.label);
  }

  const mergedEntries = Array.from(mergedByDirection.values()).map((entry) => {
    const combinedLabel = combineArrowLabels(entry.labels);
    let labelStatus = "";

    if (entry.hasMissingLabel) {
      labelStatus = "missing";
    } else if (entry.statuses.includes("incorrect")) {
      labelStatus = "incorrect";
    } else if (entry.statuses.length > 0 && entry.statuses.every((status) => status === "correct")) {
      labelStatus = "correct";
    }

    return {
      ...entry,
      label: combinedLabel,
      arrowLabel: combinedLabel,
      labelStatus,
      hasCompleteLabel: !entry.hasMissingLabel,
      directionConflict: false,
    };
  });

  const directionsByPair = new Map();
  for (const entry of mergedEntries) {
    const fromComparable = normalizeComparableChemistryText(entry.fromNode);
    const toComparable = normalizeComparableChemistryText(entry.toNode);
    const pairKey = [fromComparable, toComparable].sort().join("<->");
    const existing = directionsByPair.get(pairKey) || new Set();
    existing.add(`${fromComparable}=>${toComparable}`);
    directionsByPair.set(pairKey, existing);
  }

  return mergedEntries.map((entry) => {
    const fromComparable = normalizeComparableChemistryText(entry.fromNode);
    const toComparable = normalizeComparableChemistryText(entry.toNode);
    const pairKey = [fromComparable, toComparable].sort().join("<->");
    const directionCount = directionsByPair.get(pairKey)?.size || 1;

    if (directionCount > 1) {
      return {
        ...entry,
        directionConflict: true,
        labelStatus: "incorrect",
      };
    }

    return entry;
  });
}

function hasOppositeDirections(entries) {
  const directionsByPair = new Map();

  for (const entry of entries) {
    const fromComparable = normalizeComparableChemistryText(entry.fromNode);
    const toComparable = normalizeComparableChemistryText(entry.toNode);
    if (!fromComparable || !toComparable || fromComparable === toComparable) {
      continue;
    }

    const pairKey = [fromComparable, toComparable].sort().join("<->");
    const directionKey = `${fromComparable}=>${toComparable}`;
    const existing = directionsByPair.get(pairKey) || new Set();
    existing.add(directionKey);
    directionsByPair.set(pairKey, existing);
  }

  for (const directions of directionsByPair.values()) {
    if (directions.size > 1) {
      return true;
    }
  }

  return false;
}

function revalidateMergedArrowEntries(entries, question, targetReaction) {
  const validatedEntries = [...entries];
  const revalidatableEntries = [];
  const revalidatableIndexes = [];

  entries.forEach((entry, index) => {
    if (entry.directionConflict || entry.source !== "arrow") {
      return;
    }

    revalidatableEntries.push(entry);
    revalidatableIndexes.push(index);
  });

  const revalidatedSubset = validateBondEnergyLabelSigns(
    validateLabelStoichiometry(revalidatableEntries, question),
    question,
    targetReaction,
  );

  revalidatableIndexes.forEach((entryIndex, subsetIndex) => {
    validatedEntries[entryIndex] = revalidatedSubset[subsetIndex];
  });

  return validatedEntries;
}

function buildMergedActualArrowEntries(question, arrowConnections) {
  const { nodes: referenceNodes, targetReaction } = getQuestionReferenceNodes(question);
  const reconstructedFromArrows = arrowConnections.map((connection) => ({
    equation: `${connection.fromNode} -> ${connection.toNode}`,
    fromNode: connection.fromNode,
    toNode: connection.toNode,
    label: combineArrowLabels([connection.label]),
    source: "arrow",
    hasCompleteLabel: !isMissingLabel(connection.label),
    labelStatus: connection.labelStatus || "",
    missingStateSpecies: collectMissingStateSpeciesFromNodes(connection.fromNode, connection.toNode),
  }));

  const snappedEntries = reconstructedFromArrows.map((entry) => {
    const fromNode = snapToReferenceNode(entry.fromNode, referenceNodes);
    const toNode = snapToReferenceNode(entry.toNode, referenceNodes);
    const equation = `${fromNode} -> ${toNode}`;
    return { ...entry, fromNode, toNode, equation };
  });

  return revalidateMergedArrowEntries(
    mergeDirectionalArrowEntries(snappedEntries),
    question,
    targetReaction,
  );
}

function buildUndirectedArrowGraph(entries) {
  const adjacency = new Map();
  const edgeKeys = new Set();

  const addNode = (node) => {
    if (!adjacency.has(node)) {
      adjacency.set(node, new Set());
    }
  };

  for (const entry of entries) {
    const fromComparable = normalizeComparableChemistryText(entry.fromNode);
    const toComparable = normalizeComparableChemistryText(entry.toNode);
    if (!fromComparable || !toComparable || fromComparable === toComparable) {
      continue;
    }

    addNode(fromComparable);
    addNode(toComparable);
    adjacency.get(fromComparable).add(toComparable);
    adjacency.get(toComparable).add(fromComparable);
    edgeKeys.add([fromComparable, toComparable].sort().join("<->"));
  }

  return { adjacency, edgeKeys };
}

function hasUndirectedPath(adjacency, start, goal) {
  if (!adjacency.has(start) || !adjacency.has(goal)) {
    return false;
  }

  const seen = new Set([start]);
  const queue = [start];

  while (queue.length > 0) {
    const current = queue.shift();
    if (current === goal) {
      return true;
    }

    for (const neighbor of adjacency.get(current) || []) {
      if (seen.has(neighbor)) {
        continue;
      }
      seen.add(neighbor);
      queue.push(neighbor);
    }
  }

  return false;
}

function hasClosedTargetLoopCandidate(entries, targetReaction) {
  if (!targetReaction) {
    return false;
  }

  const targetLeft = normalizeComparableChemistryText(targetReaction.left);
  const targetRight = normalizeComparableChemistryText(targetReaction.right);
  if (!targetLeft || !targetRight || targetLeft === targetRight) {
    return false;
  }

  const { adjacency, edgeKeys } = buildUndirectedArrowGraph(entries);
  if (adjacency.size < 4 || edgeKeys.size < 3) {
    return false;
  }

  const directKey = [targetLeft, targetRight].sort().join("<->");
  if (edgeKeys.has(directKey)) {
    return true;
  }

  return hasUndirectedPath(adjacency, targetLeft, targetRight);
}

function collectMissingStateSpeciesFromNodes(...nodeTexts) {
  const missing = [];
  const seen = new Set();
  for (const nodeText of nodeTexts) {
    for (const species of collectSpeciesFromText(nodeText)) {
      // Bare "aq" is a solvent token (dissolution indicator), not a species that needs a state symbol.
      if (species.normalizedFormula === "aq") continue;
      if (!species.hasStateSymbol && !seen.has(species.normalizedFormula)) {
        seen.add(species.normalizedFormula);
        missing.push(species.formula);
      }
    }
  }
  return missing;
}

function reconstructArrowEquations(question, extractedEquations, extractedNodeLabels, arrowConnections) {
  const { targetReaction } = getQuestionReferenceNodes(question);
  const mergedEntries = buildMergedActualArrowEntries(question, arrowConnections);

  if (mergedEntries.length > 0) {
    if (targetReaction) {
      const targetEqComparable = normalizeComparableChemistryText(
        `${targetReaction.left} -> ${targetReaction.right}`
      );
      const targetEqStateStripped = normalizeForStateStripSnap(targetEqComparable);
      const alreadyCaptured = mergedEntries.some((entry) => {
        const entryComparable = normalizeComparableChemistryText(entry.equation);
        if (entryComparable === targetEqComparable) return true;
        return normalizeForStateStripSnap(entryComparable) === targetEqStateStripped;
      });

      const deltaHArrowDrawn = mergedEntries.some((entry) => isDeltaHLabel(entry.label));

      if (!alreadyCaptured && !deltaHArrowDrawn) {
        const foundInExtracted = extractedEquations.some(
          (eq) => normalizeComparableChemistryText(eq) === targetEqComparable
        );

        if (foundInExtracted) {
          mergedEntries.push({
            fromNode: targetReaction.left,
            toNode: targetReaction.right,
            equation: `${targetReaction.left} -> ${targetReaction.right}`,
            label: "ΔH",
            arrowLabel: "ΔH",
            source: "arrow",
            hasCompleteLabel: false,
            labelStatus: "missing",
            missingLabelHint: "Î”H",
          });
        } else {
          // Target reaction not drawn by student — include it for display but mark as inferred
          mergedEntries.push({
            fromNode: targetReaction.left,
            toNode: targetReaction.right,
            equation: `${targetReaction.left} -> ${targetReaction.right}`,
            label: "",
            arrowLabel: "",
            source: "inferred",
            hasCompleteLabel: false,
            labelStatus: "missing",
          });
        }
      }
    }

    return mergedEntries;
  }

  return extractedEquations.map((equation) => ({
    equation,
    fromNode: "",
    toNode: "",
    label: "",
    source: "explicit",
    hasCompleteLabel: null,
    labelStatus: "",
  }));
}

function isModelArrowLabelComment(comment) {
  if (typeof comment !== "string") {
    return false;
  }

  const normalized = comment.toLowerCase();
  return (
    (normalized.includes("arrow") || normalized.includes("label")) &&
    !normalized.startsWith("balance check:") &&
    !normalized.startsWith("extraction check:")
  );
}

function isEnthalpyPraiseComment(comment) {
  if (typeof comment !== "string") {
    return false;
  }

  const normalized = comment.toLowerCase();
  return normalized.includes("enthalpy") && (
    normalized.includes("correctly identified") ||
    normalized.includes("correct enthalpy") ||
    normalized.includes("right enthalpy") ||
    normalized.includes("identified the enthalpy")
  );
}

function isModelEnergyCycleStructureComment(comment) {
  if (typeof comment !== "string") {
    return false;
  }

  const normalized = comment.toLowerCase();
  return (
    (normalized.includes("energy cycle") || normalized.includes("the cycle") || normalized.includes("the diagram")) &&
    !normalized.startsWith("balance check:") &&
    !normalized.startsWith("extraction check:")
  );
}

function isModelHessLawComment(comment) {
  if (typeof comment !== "string") {
    return false;
  }

  const normalized = comment.toLowerCase();
  return normalized.includes("hess") || normalized.includes("final calculation");
}

function isModelDeltaHComment(comment) {
  if (typeof comment !== "string") {
    return false;
  }

  const normalized = comment.toLowerCase();
  return (
    normalized.includes("final answer") ||
    normalized.includes("calculated value") ||
    normalized.includes("value of") ||
    normalized.includes("value for") ||
    normalized.includes("no final calculation") ||
    normalized.includes("final calculation of")
  );
}

function isLabelFormattingNote(note) {
  if (typeof note !== "string") {
    return false;
  }

  const n = note.toLowerCase();
  return (
    n.includes("two lines") ||
    n.includes("two-line") ||
    n.includes("treated as a single label") ||
    n.includes("single label for the arrow") ||
    (n.includes("label") && (n.includes("multiline") || n.includes("multi-line")))
  );
}

function isUncertaintyExtractionNote(note) {
  if (typeof note !== "string") {
    return false;
  }

  const n = note.toLowerCase();
  return (
    n.includes("uncertain") ||
    n.includes("unclear") ||
    n.includes("ambiguous") ||
    n.includes("illegible") ||
    n.includes("hard to read") ||
    n.includes("difficult to read") ||
    n.includes("could not") ||
    n.includes("cannot determine") ||
    n.includes("can't determine") ||
    n.includes("unable to determine") ||
    n.includes("not confidently") ||
    n.includes("not clear") ||
    n.includes("uncertainty")
  );
}

function isLowConfidenceExtraction(extractionNotes, uncertainExtractions) {
  const uncertaintyNotes = extractionNotes.filter(
    (note) => !isLabelFormattingNote(note) && isUncertaintyExtractionNote(note)
  );
  return uncertaintyNotes.length > 0 || uncertainExtractions.length > 0;
}

function isTargetReactionArrow(entry, targetReaction) {
  if (!entry || !targetReaction) {
    return false;
  }

  const fromComparable = normalizeComparableChemistryText(entry.fromNode);
  const toComparable = normalizeComparableChemistryText(entry.toNode);
  const leftComparable = normalizeComparableChemistryText(targetReaction.left);
  const rightComparable = normalizeComparableChemistryText(targetReaction.right);

  return (
    (fromComparable === leftComparable && toComparable === rightComparable) ||
    (fromComparable === rightComparable && toComparable === leftComparable)
  );
}

function isDeltaHLabel(label) {
  const normalized = normalizeComparableChemistryText(label);
  // Accept ΔH/∆H/dH/δh and subscripted forms like ΔHsol, ΔH_soln, ΔHhyd, ΔHf, ΔH(sol), etc.
  return /^(?:δ|∆|î´|d|delta)h[_a-z0-9()]*$/.test(normalized);
}

function summarizeArrowLabels(arrowDerivedChecks, targetReaction, lowConfidenceExtraction, oppositeDirectionDetected = false) {
  if (arrowDerivedChecks.length === 0) {
    return "uncertain";
  }

  if (oppositeDirectionDetected) {
    return lowConfidenceExtraction ? "uncertain" : "incorrect";
  }

  let hasUncertain = false;

  for (const entry of arrowDerivedChecks) {
    if (entry.labelStatus === "missing" || entry.hasCompleteLabel === false) {
      return lowConfidenceExtraction ? "uncertain" : "incorrect";
    }

    // ΔH-labelled arrows represent the overall reaction — skip label scoring for them
    if (isDeltaHLabel(entry.arrowLabel)) {
      continue;
    }

    if (entry.labelStatus === "incorrect") {
      // Deterministic sign/value mismatch — only raised when the numeric label
      // was read successfully, so extraction confidence is not relevant here.
      return "incorrect";
    }

    if (entry.labelStatus === "correct") {
      continue;
    }

    hasUncertain = true;
  }

  return hasUncertain ? "uncertain" : "correct";
}

const UNICODE_SUBSCRIPT_TO_ASCII = {
  "₀": "0", "₁": "1", "₂": "2", "₃": "3", "₄": "4",
  "₅": "5", "₆": "6", "₇": "7", "₈": "8", "₉": "9",
};

function normalizeFormulaKey(text, { preserveState = false } = {}) {
  const asciiText = Array.from(normalizeEquationText(String(text ?? ""))).map((c) => UNICODE_SUBSCRIPT_TO_ASCII[c] ?? c).join("");
  const normalized = asciiText
    .toLowerCase()
    .replace(/\s+/g, "")
    .trim();

  return preserveState
    ? normalized
    : normalized.replace(/\((?:s|l|g|aq)\)$/i, "");
}

function hasExplicitSpeciesState(formulaAndState) {
  return /\((?:s|l|g|aq)\)\s*$/i.test(normalizeEquationText(String(formulaAndState ?? "")));
}

function parseNodeCoefficient(coeffText) {
  if (!coeffText) {
    return 1;
  }

  return coeffText.includes("/")
    ? Number(coeffText.split("/")[0]) / Number(coeffText.split("/")[1])
    : parseFloat(coeffText);
}

function extractSimpleNumericFromLabel(label) {
  if (!label || isMissingLabel(label)) {
    return null;
  }

  const cleaned = String(label).replace(/[()]/g, "").trim();
  const match = cleaned.match(/^[+-]?\d+(?:\.\d+)?$/);
  return match ? parseFloat(match[0]) : null;
}

function extractNumericExpressionTotal(label) {
  if (!label || isMissingLabel(label) || isDeltaHLabel(label)) {
    return null;
  }

  const normalized = normalizeEquationText(String(label))
    .replace(/[−–—]/g, "-")
    .replace(/\s+/g, "")
    .replace(/[x×X]/g, "*")
    .replace(/(?<=\d)\(/g, "*(")
    .replace(/\)(?=\d)/g, ")*")
    .replace(/\)\(/g, ")*(");

  if (!normalized || /[^0-9+\-*/().]/.test(normalized)) {
    return null;
  }

  try {
    const total = Function(`"use strict"; return (${normalized});`)();
    return typeof total === "number" && Number.isFinite(total) ? total : null;
  } catch {
    return null;
  }
}

function extractProductFromReferenceEquation(equationText) {
  const sides = equationText.split(/\s*(?:->|→|⟶|⟹|=>|=)\s*/);
  if (sides.length !== 2) {
    return null;
  }

  const rightTerms = maskCharges(sides[1].trim())
    .split("+")
    .map((s) => unmaskCharges(s).trim())
    .filter(Boolean);
  if (rightTerms.length !== 1) {
    return null;
  }

  const match = rightTerms[0].match(/^(\d+(?:\/\d+)?|\d*\.\d+)?\s*(.+)$/);
  if (!match) {
    return null;
  }

  const [, coeffText, formulaAndState] = match;
  const coeff = parseNodeCoefficient(coeffText);

  return {
    formulaKey: normalizeFormulaKey(formulaAndState),
    exactFormulaKey: normalizeFormulaKey(formulaAndState, { preserveState: true }),
    coeff,
  };
}

function parseStoichiometricTerms(text) {
  return maskCharges(stripStandaloneAqueousContext(String(text ?? "")))
    .split("+")
    .map((s) => unmaskCharges(s).trim())
    .filter(Boolean)
    .map((term) => {
      const match = term.match(/^(\d+(?:\/\d+)?|\d*\.\d+)?\s*(.+)$/);
      if (!match) {
        return null;
      }

      const [, coeffText, formulaAndState] = match;
      return {
        coeff: parseNodeCoefficient(coeffText),
        formulaKey: normalizeFormulaKey(formulaAndState),
        exactFormulaKey: normalizeFormulaKey(formulaAndState, { preserveState: true }),
        hasExplicitState: hasExplicitSpeciesState(formulaAndState),
      };
    })
    .filter(Boolean);
}

function buildTermIndex(text) {
  const exactCounts = new Map();
  const formulaCounts = new Map();
  const noStateCounts = new Map();

  for (const term of parseStoichiometricTerms(text)) {
    exactCounts.set(term.exactFormulaKey, (exactCounts.get(term.exactFormulaKey) || 0) + term.coeff);
    formulaCounts.set(term.formulaKey, (formulaCounts.get(term.formulaKey) || 0) + term.coeff);
    if (!term.hasExplicitState) {
      noStateCounts.set(term.formulaKey, (noStateCounts.get(term.formulaKey) || 0) + term.coeff);
    }
  }

  return { exactCounts, formulaCounts, noStateCounts };
}

function getAvailableTermCount(index, targetTerm) {
  const exactAvail = index.exactCounts.get(targetTerm.exactFormulaKey) || 0;
  const noStateAvail = index.noStateCounts.get(targetTerm.formulaKey) || 0;
  const formulaAvail = index.formulaCounts.get(targetTerm.formulaKey) || 0;
  return { exactAvail, noStateAvail, formulaAvail };
}

function matchesScaledSide(nodeText, sideTerms, multiplier) {
  const index = buildTermIndex(nodeText);
  let sawStateConflict = false;

  for (const term of sideTerms) {
    const required = term.coeff * multiplier;
    const { exactAvail, noStateAvail, formulaAvail } = getAvailableTermCount(index, term);

    if (exactAvail >= required) {
      continue;
    }

    if (exactAvail + noStateAvail >= required) {
      continue;
    }

    if (formulaAvail > 0) {
      sawStateConflict = true;
    }

    return { matched: false, sawStateConflict };
  }

  return { matched: true, sawStateConflict };
}

function findRowMatchMultipliers(nodeText, sideTerms) {
  const index = buildTermIndex(nodeText);
  const candidates = [];
  const seen = new Set();

  for (const term of sideTerms) {
    const { exactAvail, noStateAvail, formulaAvail } = getAvailableTermCount(index, term);
    for (const available of [exactAvail, exactAvail + noStateAvail, formulaAvail]) {
      if (available >= term.coeff && term.coeff > 0) {
        const ratio = Math.round((available / term.coeff) * 1000) / 1000;
        const key = String(ratio);
        if (!seen.has(key)) {
          seen.add(key);
          candidates.push(ratio);
        }
      }
    }
  }

  candidates.sort((a, b) => a - b);
  return candidates;
}

function matchReferenceRowDirection(fromNode, toNode, leftTerms, rightTerms) {
  let sawStateConflict = false;

  for (const multiplier of findRowMatchMultipliers(toNode, rightTerms)) {
    const rightMatch = matchesScaledSide(toNode, rightTerms, multiplier);
    sawStateConflict ||= rightMatch.sawStateConflict;
    if (!rightMatch.matched) {
      continue;
    }

    const leftMatch = matchesScaledSide(fromNode, leftTerms, multiplier);
    sawStateConflict ||= leftMatch.sawStateConflict;
    if (leftMatch.matched) {
      return { matched: true, multiplier, sawStateConflict };
    }
  }

  return { matched: false, multiplier: 0, sawStateConflict };
}

function findCoeffInNodeText(nodeText, targetProduct) {
  let fallbackMatch = null;
  let stateConflictMatch = null;

  for (const term of maskCharges(nodeText)
    .split("+")
    .map((s) => unmaskCharges(s).trim())
    .filter(Boolean)) {
    const match = term.match(/^(\d+(?:\/\d+)?|\d*\.\d+)?\s*(.+)$/);
    if (!match) {
      continue;
    }

    const [, coeffText, formulaAndState] = match;
    const coeff = parseNodeCoefficient(coeffText);
    const exactFormulaKey = normalizeFormulaKey(formulaAndState, { preserveState: true });
    const formulaKey = normalizeFormulaKey(formulaAndState);
    if (exactFormulaKey === targetProduct.exactFormulaKey) {
      return { coeff, matchType: "exact" };
    }

    if (formulaKey !== targetProduct.formulaKey) {
      continue;
    }

    if (!hasExplicitSpeciesState(formulaAndState)) {
      fallbackMatch ||= { coeff, matchType: "state-missing" };
      continue;
    }

    stateConflictMatch ||= { coeff, matchType: "state-conflict" };
  }

  return fallbackMatch || stateConflictMatch || { coeff: 0, matchType: "none" };
}

function deriveExpectedLabelTotal(conn, question) {
  const referenceTable = question?.data?.table || [];
  let expectedTotal = 0;
  let contributionCount = 0;
  let sawStateConflict = false;

  for (const row of referenceTable) {
    if (typeof row.value !== "number" || !row.equation) {
      continue;
    }

    const reaction = splitReactionSides(row.equation);
    if (!reaction) {
      continue;
    }

    const leftTerms = parseStoichiometricTerms(reaction.left);
    const rightTerms = parseStoichiometricTerms(reaction.right);
    if (leftTerms.length === 0 || rightTerms.length === 0) {
      continue;
    }

    const forwardMatch = matchReferenceRowDirection(conn.fromNode, conn.toNode, leftTerms, rightTerms);
    sawStateConflict ||= forwardMatch.sawStateConflict;
    if (forwardMatch.matched) {
      expectedTotal += forwardMatch.multiplier * row.value;
      contributionCount += 1;
      continue;
    }

    const reverseMatch = matchReferenceRowDirection(conn.fromNode, conn.toNode, rightTerms, leftTerms);
    sawStateConflict ||= reverseMatch.sawStateConflict;
    if (reverseMatch.matched) {
      expectedTotal += -reverseMatch.multiplier * row.value;
      contributionCount += 1;
    }
  }

  return { expectedTotal, contributionCount, sawStateConflict };
}

function validateLabelStoichiometry(arrowConnections, question) {
  return arrowConnections.map((conn) => {
    if (isMissingLabel(conn.label) || isDeltaHLabel(conn.label)) {
      return conn;
    }

    const labelTotal = extractNumericExpressionTotal(conn.label);
    if (labelTotal === null) {
      return conn;
    }

    const { expectedTotal, contributionCount, sawStateConflict } = deriveExpectedLabelTotal(conn, question);
    if (contributionCount > 0) {
      if (Math.abs(labelTotal - expectedTotal) > 0.6) {
        return { ...conn, labelStatus: "incorrect" };
      }
      return { ...conn, labelStatus: "correct" };
    }

    if (sawStateConflict) {
      return { ...conn, labelStatus: "incorrect" };
    }

    return conn;
  });
}

function getReferenceAbsoluteValues(question) {
  return (question?.data?.table || [])
    .map((row) => row.value)
    .filter((v) => typeof v === "number" && isFinite(v))
    .map((v) => Math.abs(v));
}

function overrideLabelStatusFromReferenceData(arrowConnections, question) {
  const refAbsValues = getReferenceAbsoluteValues(question);
  if (refAbsValues.length === 0) {
    return arrowConnections;
  }

  return arrowConnections.map((conn) => {
    if (conn.labelStatus !== "incorrect") {
      return conn;
    }

    const label = conn.label?.trim();
    if (!label || isMissingLabel(label)) {
      return conn;
    }

    const simpleNumericMatch = label.match(/^[+-]?\d+(?:\.\d+)?$/);
    if (!simpleNumericMatch) {
      return conn;
    }

    const numericValue = parseFloat(label);
    if (isNaN(numericValue)) {
      return conn;
    }

    const absValue = Math.abs(numericValue);
    const matchesReference = refAbsValues.some((refAbs) => Math.abs(absValue - refAbs) < 0.6);
    if (matchesReference) {
      return { ...conn, labelStatus: "correct" };
    }

    return conn;
  });
}

function isBondEnergyQuestion(question) {
  return (question?.data?.table || []).some(
    (row) => typeof row.enthalpy === "string" && row.enthalpy.toLowerCase().includes("bond energy")
  );
}

function findAtomsIntermediateNode(arrowConnections, targetReaction) {
  if (!targetReaction) {
    return null;
  }

  const leftComp = normalizeComparableChemistryText(targetReaction.left);
  const rightComp = normalizeComparableChemistryText(targetReaction.right);
  const leftStripped = normalizeForStateStripSnap(leftComp);
  const rightStripped = normalizeForStateStripSnap(rightComp);

  const matchesTarget = (comp) => {
    if (!comp) return false;
    if (comp === leftComp || comp === rightComp) return true;
    const stripped = normalizeForStateStripSnap(comp);
    return Boolean(stripped) && (stripped === leftStripped || stripped === rightStripped);
  };

  for (const conn of arrowConnections) {
    const fromComp = normalizeComparableChemistryText(conn.fromNode);
    const toComp = normalizeComparableChemistryText(conn.toNode);
    if (fromComp && !matchesTarget(fromComp)) {
      return conn.fromNode;
    }
    if (toComp && !matchesTarget(toComp)) {
      return conn.toNode;
    }
  }

  return null;
}

function getLabelNetSign(label) {
  const str = String(label).replace(/\s+/g, "");
  // Negative if starts with minus, or if any parenthesised value is negative: (-NNN)
  if (/^-/.test(str) || /\(-\d/.test(str)) {
    return "negative";
  }
  return "positive";
}

function validateBondEnergyLabelSigns(arrowConnections, question, targetReaction) {
  if (!isBondEnergyQuestion(question)) {
    return arrowConnections;
  }

  const atomsNode = findAtomsIntermediateNode(arrowConnections, targetReaction);
  if (!atomsNode) {
    return arrowConnections;
  }

  const atomsComp = normalizeComparableChemistryText(atomsNode);
  const atomsStripped = normalizeForStateStripSnap(atomsComp);

  const matchesAtoms = (comp) => {
    if (!comp) return false;
    if (comp === atomsComp) return true;
    const stripped = normalizeForStateStripSnap(comp);
    return Boolean(stripped) && stripped === atomsStripped;
  };

  return arrowConnections.map((conn) => {
    if (conn.labelStatus !== "correct") {
      return conn;
    }
    if (isMissingLabel(conn.label)) {
      return conn;
    }

    const fromComp = normalizeComparableChemistryText(conn.fromNode);
    const toComp = normalizeComparableChemistryText(conn.toNode);
    const isBondBreaking = matchesAtoms(toComp);   // molecules → atoms: label must be positive
    const isBondForming = matchesAtoms(fromComp);  // atoms → molecules: label must be negative

    if (!isBondBreaking && !isBondForming) {
      return conn;
    }

    const sign = getLabelNetSign(conn.label);
    if (isBondBreaking && sign === "negative") {
      return { ...conn, labelStatus: "incorrect" };
    }
    if (isBondForming && sign === "positive") {
      return { ...conn, labelStatus: "incorrect" };
    }

    return conn;
  });
}

export async function analyzeStudentWork(question, imageBase64, analysisImages = []) {
  if (!question || !imageBase64) {
    throw new Error("Question and image are required.");
  }

  const prompt = `
    You are an expert Chemistry Teacher specializing in Thermodynamics and Hess's Law.
    You must separate what is visibly written from what you infer.
    You are given multiple images of the SAME submission. Later images may be sharper crops of the full whiteboard.
    Use all images together and prefer the clearest crop when handwriting is small.

    A student has submitted a handwritten diagram (energy cycle or energy level diagram) in response to the following question:

    QUESTION:
    Subject: ${question.title}
    Instruction: ${question.instruction}
    Equation to Solve: ${question.data.reaction}
    Reference Data: ${JSON.stringify(question.data.table)}
    Expected Hess's Law Setup: ${question.answerHessLaw}
    Expected Final Value: ${question.expectedValue}

    MARKING CHECKLIST:
    1. Are all equations in the cycle balanced?
    2. Are there state symbols (s, l, g, aq) for ALL species?
    3. Are all arrows labelled with the specified ΔH or correct numerical value?
    4. Is Hess's Law applied correctly to reach the final answer?

    YOUR TASK:
    1. Extract any explicit full reaction equations the student has written.
    2. Extract the standalone node labels in the Hess cycle.
    3. Identify each arrow connection by start node, end node, and visible label.
    4. Classify whether the energy cycle diagram is structurally complete or incomplete.
    5. Classify the Hess's Law mathematical calculation as correct, incorrect, or missing.
    6. Classify the final ΔH numerical value as correct, incorrect, or missing.
    7. Mark the student's work based on the checklist.
    8. Provide constructive feedback (do NOT include general remarks about the cycle being well-drawn or clearly structured).

    ARROW DIRECTION RULES (critical — read carefully):
    - The arrowhead marks the DESTINATION (toNode). It appears as a pointed V-shape, >, or angular mark at one end of the drawn line.
    - For diagonal or slanted arrows: identify which physical end of the line has the pointed angular mark — that end is toNode, regardless of whether the arrow goes up, down, left, or right.
    - Do not assume a typical Hess cycle direction pattern. In some student drawings, the slanted arrows point upward into the top boxes; in others, they point downward into the lower box.
    - Never assume direction from chemistry or diagram convention — rely only on the visible arrowhead position.
    - If you are genuinely unsure about the direction of a slanted arrow, note the uncertainty in extractionNotes.
    - CRITICAL: Record every arrowConnection EXACTLY as the arrow is drawn. fromNode is always the tail (where the arrow starts); toNode is always the arrowhead (where the arrow ends). Do NOT reverse the equation direction for any reason — not to match chemistry sign conventions, not to make the equation look more natural. The student's arrow direction is the ground truth.

    EXTRACTION RULES:
    - Transcribe text exactly as written. Do not silently correct chemistry, coefficients, species, or state symbols.
    - State symbols matter. Preserve every visible (s), (l), (g), or (aq) exactly when you can see it.
    - If a token is unclear, preserve the visible text as closely as possible and mention the uncertainty in extractionNotes.
    - Do not replace a handwritten coefficient with the chemically correct one just because it seems intended.
    - Put only complete reaction equations with an explicit reaction arrow into extractedEquations.
    - Put node text such as reactants, products, or common intermediates into extractedNodeLabels.
    - For arrowConnections, use the node text the arrow visually connects between. Do not invent nodes that are not present.
    - Keep each drawn arrow separate. Do not merge nearby arrows into one combined arrow connection.
    - If several arrows leave the same lower node toward different products, return separate arrowConnections for each visible arrow.
    - If two arrows have the same start node, the same end node, and the same direction, treat them as one combined reaction step and combine their labels mathematically.
    - If two arrows connect the same pair of nodes but point in opposite directions, treat that as a direction inconsistency rather than a valid combined label.
    - Do not infer arrow direction from chemistry; use only the visible arrowhead. If the arrowhead is unclear, keep the most literal reading and mention the uncertainty in extractionNotes.
    - If a drawn arrow (with a visible arrowhead) connects the reactant node to the product node — even if it is labeled only "ΔH" — record it as an arrowConnection. Do NOT treat it as a standalone annotation or put it in extractedEquations. Only put the target reaction in extractedEquations if there is no drawn arrow at all connecting those two nodes.
    - Treat floating combustion notes, added O2 terms, or small annotations written above or below a node as separate notes, not as part of that node.
    - Do not merge a nearby note into fromNode or toNode unless it is clearly written inline on the same baseline as the node text.
    - Treat floating combustion notes, added O2 terms, or small annotations written above or below a node as separate notes, not as part of that node.
    - Do not merge a nearby note into fromNode or toNode unless it is clearly written inline on the same baseline as the node text.
    - Do not treat arrow labels such as "-394", "4(-285.8)", or "ΔH" as equations.
    - Treat floating combustion notes, added O2 terms, or small annotations written above or below a node as separate notes, not as part of that node.
    - Do not merge a nearby note into fromNode or toNode unless it is clearly written inline on the same baseline as the node text.
    - In comments and hessLawApplication, base balance judgments on the implied equation for each arrow connection.
    - energyCycleStatus is about structure only: "complete" if all needed nodes and arrows are present and connected; "incomplete" if the cycle is missing nodes, arrows, or is disconnected.
    - hessLawStatus is about whether the student has CORRECTLY SET UP the Hess's Law formula — correct signs and correct reference values substituted. It is NOT about the final arithmetic result.
    - Use hessLawStatus = "missing" if the student has not written any explicit algebraic Hess's Law calculation (e.g. ΔH = value1 + value2 - value3).
    - Use hessLawStatus = "incorrect" if a written Hess's Law calculation is present but uses wrong signs or wrong reference values in the formula itself.
    - Use hessLawStatus = "correct" if the student has correctly written the formula with the right signs and right values, even if their arithmetic on the next line contains an error.
    - deltaHCalculationStatus is ONLY about the final numerical answer written by the student (e.g. "ΔH = -2719 kJ mol⁻¹" or just "-2719"). Ignore energy cycle structure completely.
    - Use deltaHCalculationStatus = "missing" if no final numerical ΔH value is written anywhere on the page.
    - Use deltaHCalculationStatus = "incorrect" if a final numerical ΔH value is written but does not match ${question.expectedValue}.
    - Use deltaHCalculationStatus = "correct" if the final numerical ΔH value written matches ${question.expectedValue} (allow minor rounding within ±1 unit).

    Remember: the goal is to reconstruct the equations represented by the Hess-cycle arrows.
  `;

  const normalizedImages = Array.isArray(analysisImages) && analysisImages.length > 0
    ? analysisImages
    : [imageBase64];
  const imageParts = normalizedImages
    .filter((entry) => typeof entry === "string" && entry.trim())
    .map((entry) => (entry.includes(",") ? entry.split(",")[1] : entry))
    .map((data) => ({
      inlineData: {
        mimeType: "image/png",
        data,
      },
    }));

  const ai = getGeminiClient();
  const response = await ai.models.generateContent({
    model: getGeminiModel(),
    contents: {
      parts: [
        ...imageParts,
        { text: prompt },
      ],
    },
    config: {
      responseMimeType: "application/json",
      responseSchema: RESPONSE_SCHEMA,
    },
  });

  if (!response.text) {
    throw new Error("AI failed to provide feedback.");
  }

  const parsedResponse = JSON.parse(response.text);
  const { targetReaction: questionTargetReaction } = getQuestionReferenceNodes(question);
  const extractedEquations = normalizeStringArray(parsedResponse.extractedEquations);
  const extractedNodeLabels = normalizeStringArray(parsedResponse.extractedNodeLabels);
  const arrowConnections = validateBondEnergyLabelSigns(
    validateLabelStoichiometry(
      overrideLabelStatusFromReferenceData(
        normalizeArrowConnections(parsedResponse.arrowConnections),
        question,
      ),
      question,
    ),
    question,
    questionTargetReaction,
  );
  const oppositeDirectionDetected = hasOppositeDirections(arrowConnections);
  const extractionNotes = normalizeStringArray(parsedResponse.extractionNotes).filter(
    (note) => !isLabelFormattingNote(note)
  );
  const reconstructedEquations = reconstructArrowEquations(question, extractedEquations, extractedNodeLabels, arrowConnections);
  const reconstructedEquationChecks = validateExtractedEquations(reconstructedEquations.map((entry) => entry.equation))
    .map((check, index) => ({
      ...check,
      fromNode: reconstructedEquations[index]?.fromNode || "",
      toNode: reconstructedEquations[index]?.toNode || "",
      arrowLabel: reconstructedEquations[index]?.label || "",
      source: reconstructedEquations[index]?.source || "explicit",
      hasCompleteLabel: reconstructedEquations[index]?.hasCompleteLabel ?? null,
      labelStatus: reconstructedEquations[index]?.labelStatus || "",
      missingLabelHint: reconstructedEquations[index]?.missingLabelHint || "",
      missingStateSpecies: reconstructedEquations[index]?.missingStateSpecies || [],
    }));

  const unbalancedEquations = reconstructedEquationChecks.filter((entry) => entry.status === "unbalanced");
  const uncertainExtractions = reconstructedEquationChecks.filter((entry) => entry.status === "unverifiable");
  const lowConfidenceExtraction = isLowConfidenceExtraction(extractionNotes, uncertainExtractions);

  let score = typeof parsedResponse.score === "number" ? parsedResponse.score : 0;
  if (!lowConfidenceExtraction && unbalancedEquations.length > 0) {
    score = Math.max(0, Math.min(score, 6) - Math.max(0, unbalancedEquations.length - 1));
  }

  const modelComments = normalizeStringArray(parsedResponse.comments);
  const rawEnergyCycleStatus = normalizeBinaryStatus(parsedResponse.energyCycleStatus);
  const hessLawStatus = normalizeTernaryStatus(parsedResponse.hessLawStatus);
  const deltaHCalculationStatus = normalizeTernaryStatus(parsedResponse.deltaHCalculationStatus);
  const targetReaction = questionTargetReaction;
  const actualMergedArrowEntries = buildMergedActualArrowEntries(question, arrowConnections);
  const targetReactionFromActualArrow = reconstructedEquations.some(
    (entry) => entry.source === "arrow" && (
      isTargetReactionArrow(entry, targetReaction) || isDeltaHLabel(entry.label)
    )
  );
  const deterministicStructureComplete = targetReactionFromActualArrow || (
    rawEnergyCycleStatus === "complete" &&
    hasClosedTargetLoopCandidate(actualMergedArrowEntries, targetReaction)
  );
  const energyCycleStatus = deterministicStructureComplete ? "complete" : "incomplete";
  const stateSymbolEvaluation = evaluateStateSymbols(
    question,
    extractedEquations,
    extractedNodeLabels,
    arrowConnections,
    lowConfidenceExtraction,
  );
  const comments = modelComments
    .filter((comment) => !isModelArrowLabelComment(comment))
    .filter((comment) => !isEnthalpyPraiseComment(comment))
    .filter((comment) => !isModelHessLawComment(comment))
    .filter((comment) => !isModelDeltaHComment(comment))
    .filter((comment) => !isModelEnergyCycleStructureComment(comment));

  if (!lowConfidenceExtraction) {
    for (const failingEquation of unbalancedEquations) {
    comments.unshift(`Balance check: "${failingEquation.equation}" is unbalanced. ${failingEquation.issue}`);
    }
  }

  if (lowConfidenceExtraction) {
    comments.unshift("Extraction check: low-confidence handwriting extraction detected, so balance penalties were suppressed.");
  }

  const arrowDerivedChecks = reconstructedEquationChecks.filter((entry) => entry.source === "arrow");
  const arrowLabelStatus = summarizeArrowLabels(arrowDerivedChecks, targetReaction, lowConfidenceExtraction, oppositeDirectionDetected);
  const cycleStructureSummary = energyCycleStatus
    ? (lowConfidenceExtraction && energyCycleStatus === "incomplete" ? "uncertain" : energyCycleStatus)
    : "uncertain";
  const equationsBalancedSummary = uncertainExtractions.length > 0
    ? "uncertain"
    : (unbalancedEquations.length > 0 ? "incorrect" : "correct");
  const hessLawSummary = normalizeSummaryStatus(hessLawStatus);
  const finalDeltaHSummary = normalizeSummaryStatus(deltaHCalculationStatus);

  if (cycleStructureSummary === "incomplete") {
    comments.unshift("Cycle structure check: the extracted cycle appears incomplete.");
  } else if (cycleStructureSummary === "uncertain") {
    comments.unshift("Cycle structure check: the cycle structure could not be confirmed confidently from the extracted handwriting.");
  }

  if (stateSymbolEvaluation.status === "incorrect") {
    comments.push(`State symbol check: missing or unreadable state symbols for ${stateSymbolEvaluation.missingStateSpecies.join(", ")}.`);
  } else if (stateSymbolEvaluation.status === "uncertain") {
    comments.push("State symbol check: state symbols could not be verified confidently from the extracted handwriting.");
  }

  if (arrowLabelStatus === "incorrect") {
    comments.push("Arrow label check: one or more arrow labels are missing or inconsistent with the reference values.");
  } else if (arrowLabelStatus === "uncertain") {
    comments.push("Arrow label check: some arrow labels could not be verified confidently from the extracted handwriting.");
  }

  if (hessLawSummary === "correct") {
    comments.push("correct application of Hess's Law");
  } else if (hessLawSummary === "incorrect") {
    comments.push("incorrect application of Hess's Law");
  } else if (hessLawSummary === "missing") {
    comments.push("missing application of Hess's Law");
  }

  if (finalDeltaHSummary === "correct") {
    comments.push("correct calculated ΔH value");
  } else if (finalDeltaHSummary === "incorrect") {
    comments.push("incorrect calculated ΔH value");
  } else if (finalDeltaHSummary === "missing") {
    comments.push("missing calculated ΔH value");
  }

  let hessLawApplication = typeof parsedResponse.hessLawApplication === "string"
    ? parsedResponse.hessLawApplication
    : "";

  if (lowConfidenceExtraction) {
    hessLawApplication = `Low-confidence handwriting extraction was detected, so reconstructed equations were excluded from balance penalties. ${hessLawApplication}`.trim();
  } else if (unbalancedEquations.length > 0) {
    hessLawApplication = `Deterministic validation found ${unbalancedEquations.length} unbalanced reconstructed equation${unbalancedEquations.length === 1 ? "" : "s"}. ${hessLawApplication}`.trim();
  }

  return {
    score,
    comments,
    hessLawApplication,
    summary: {
      cycleStructure: cycleStructureSummary,
      allEquationsBalanced: equationsBalancedSummary,
      stateSymbols: stateSymbolEvaluation.status,
      arrowLabelsAndDirection: arrowLabelStatus,
      hessLaw: hessLawSummary,
      finalDeltaH: finalDeltaHSummary,
    },
    diagnostics: {
      missingStateSpecies: stateSymbolEvaluation.missingStateSpecies,
      stateEvidenceSpecies: stateSymbolEvaluation.stateEvidenceSpecies,
    },
    extractedEquations,
    extractedNodeLabels,
    arrowConnections,
    extractionNotes,
    reconstructedEquationChecks,
  };
}
