export interface Question {
  id: string;
  title: string;
  instruction: string;
  data: {
    reaction: string;
    table: Array<{
      enthalpy: string;
      value?: number;
      equation?: string;
    }>;
  };
  answerHessLaw: string;
  expectedValue: string;
  useDataBooklet?: boolean;
}

export interface Feedback {
  score: number;
  comments: string[];
  hessLawApplication: string;
  summary: {
    cycleStructure: "complete" | "incomplete" | "uncertain";
    stateSymbols: "correct" | "incorrect" | "uncertain";
    arrowLabelsAndDirection: "correct" | "incorrect" | "uncertain";
    hessLaw: "correct" | "incorrect" | "missing" | "uncertain";
    finalDeltaH: "correct" | "incorrect" | "missing" | "uncertain";
  };
  diagnostics: {
    missingStateSpecies: string[];
    stateEvidenceSpecies: string[];
  };
  extractedEquations: string[];
  extractedNodeLabels: string[];
  arrowConnections: Array<{
    fromNode: string;
    toNode: string;
    label: string;
  }>;
  extractionNotes: string[];
  reconstructedEquationChecks: Array<{
    equation: string;
    normalizedEquation: string;
    status: "balanced" | "unbalanced" | "unverifiable" | "ignored";
    isBalanced: boolean | null;
    issue: string | null;
    fromNode: string;
    toNode: string;
    arrowLabel: string;
    source: string;
    hasCompleteLabel: boolean | null;
    labelStatus: string;
  }>;
}
