import { Question } from "./types";

export const QUESTIONS: Question[] = [
  {
    id: "q13",
    title: "Combustion of But-1-ene",
    instruction: "Using the data in the table below, draw an energy cycle to calculate ΔH for the following reaction:",
    data: {
      reaction: "C₄H₈(g) + 6O₂(g) → 4CO₂(g) + 4H₂O(l)",
      table: [
        {
          enthalpy: "ΔH_f of C₄H₈(g)",
          value: -1,
          equation: "4C(s) + 4H₂(g) → C₄H₈(g)",
        },
        {
          enthalpy: "ΔH_f of CO₂(g)",
          value: -394,
          equation: "C(s) + O₂(g) → CO₂(g)",
        },
        {
          enthalpy: "ΔH_f of H₂O(l)",
          value: -286,
          equation: "H₂(g) + ½O₂(g) → H₂O(l)",
        },
      ],
    },
    answerHessLaw: "ΔH = 4ΔH_f[CO₂(g)] + 4ΔH_f[H₂O(l)] - ΔH_f[C₄H₈(g)]",
    expectedValue: "-2719 kJ mol⁻¹",
  },
  {
    id: "q34",
    title: "Formation of Ammonia from Bond Energies",
    instruction: "Using the bond energy data in the table below, draw an energy cycle to calculate ΔH for the following reaction:",
    data: {
      reaction: "N₂(g) + 3H₂(g) → 2NH₃(g)",
      table: [
        {
          enthalpy: "Bond Energy N≡N",
          value: 945,
        },
        {
          enthalpy: "Bond Energy H-H",
          value: 436,
        },
        {
          enthalpy: "Bond Energy N-H",
          value: 391,
        },
      ],
    },
    answerHessLaw: "ΔH = Σ(Bond Energy broken) - Σ(Bond Energy formed) = [945 + 3(436)] - 6(391)",
    expectedValue: "-93 kJ mol⁻¹",
  },
  {
    id: "q23",
    title: "Hydration Enthalpy of Magnesium Chloride",
    instruction: "Using the data in the table below, draw an energy cycle to calculate ΔH for the following reaction:",
    data: {
      reaction: "MgCl₂(s) + aq → Mg²⁺(aq) + 2Cl⁻(aq)",
      table: [
        {
          enthalpy: "L.E. of MgCl₂(s)",
          value: -2526,
          equation: "Mg²⁺(g) + 2Cl⁻(g) → MgCl₂(s)",
        },
        {
          enthalpy: "ΔH_hyd of Mg²⁺(g)",
          value: -1920,
          equation: "Mg²⁺(g) + aq → Mg²⁺(aq)",
        },
        {
          enthalpy: "ΔH_hyd of Cl⁻(g)",
          value: -364,
          equation: "Cl⁻(g) + aq → Cl⁻(aq)",
        },
      ],
    },
    answerHessLaw: "ΔH_soln = -L.E.[MgCl₂(s)] + ΔH_hyd[Mg²⁺(g)] + 2ΔH_hyd[Cl⁻(g)]",
    expectedValue: "-122 kJ mol⁻¹",
  },
  {
    id: "q3",
    title: "Combustion of Propane",
    instruction: "Using the data in the table below, draw an energy cycle to calculate ΔH for the following reaction:",
    data: {
      reaction: "C₃H₈(g) + 5O₂(g) → 3CO₂(g) + 4H₂O(l)",
      table: [
        {
          enthalpy: "ΔH_c of C(s)",
          value: -394,
          equation: "C(s) + O₂(g) → CO₂(g)",
        },
        {
          enthalpy: "ΔH_c of H₂(g)",
          value: -286,
          equation: "H₂(g) + ½O₂(g) → H₂O(l)",
        },
        {
          enthalpy: "ΔH_f of C₃H₈(g)",
          value: -105,
          equation: "3C(s) + 4H₂(g) → C₃H₈(g)",
        },
      ],
    },
    answerHessLaw: "ΔH = 3ΔH_c[C(s)] + 4ΔH_c[H₂(g)] - ΔH_f[C₃H₈(g)]",
    expectedValue: "-2221 kJ mol⁻¹",
  },
  {
    id: "q1",
    title: "Calcium Reaction with Water",
    instruction: "Using the data in the table below, draw an energy cycle to calculate ΔH for the following reaction:",
    data: {
      reaction: "Ca(s) + 2H₂O(l) → Ca(OH)₂(aq) + H₂(g)",
      table: [
        {
          enthalpy: "ΔH_f of H₂O(l)",
          value: -286,
          equation: "H₂(g) + ½O₂(g) → H₂O(l)",
        },
        {
          enthalpy: "ΔH_f of Ca(OH)₂(s)",
          value: -987,
          equation: "Ca(s) + H₂(g) + O₂(g) → Ca(OH)₂(s)",
        },
        {
          enthalpy: "ΔH_soln of Ca(OH)₂(s)",
          value: -408,
          equation: "Ca(OH)₂(s) → Ca(OH)₂(aq)",
        },
      ],
    },
    answerHessLaw: "ΔH = ΔH_f[Ca(OH)₂(s)] + ΔH_soln[Ca(OH)₂(s)] - 2ΔH_f[H₂O(l)]",
    expectedValue: "-823 kJ mol⁻¹",
  },
  {
    id: "q29",
    title: "Combustion of Ethanol",
    instruction: "Using the data in the table below, draw an energy cycle to calculate ΔH for the following reaction:",
    data: {
      reaction: "C₂H₅OH(l) + 3O₂(g) → 2CO₂(g) + 3H₂O(l)",
      table: [
        {
          enthalpy: "ΔH_f of C₂H₅OH(l)",
          value: -278,
        },
        {
          enthalpy: "ΔH_f of CO₂(g)",
          value: -394,
        },
        {
          enthalpy: "ΔH_f of H₂O(l)",
          value: -286,
        },
      ],
    },
    answerHessLaw: "ΔH = 2ΔH_f[CO₂(g)] + 3ΔH_f[H₂O(l)] - ΔH_f[C₂H₅OH(l)]",
    expectedValue: "-1368 kJ mol⁻¹",
  },
  {
    id: "q36",
    title: "Formation of Water",
    instruction: "Using the data in the table below, draw an energy cycle to calculate ΔH for the following reaction:",
    data: {
      reaction: "2H₂(g) + O₂(g) → 2H₂O(l)",
      table: [
        {
          enthalpy: "ΔH_f of H₂O(l)",
          value: -286,
          equation: "H₂(g) + ½O₂(g) → H₂O(l)",
        },
      ],
    },
    answerHessLaw: "ΔH = 2ΔH_f[H₂O(l)]",
    expectedValue: "-572 kJ mol⁻¹",
  },
  {
    id: "q38",
    title: "Formation of Hydrogen Iodide",
    instruction: "Using the data in the table below, draw an energy cycle to calculate ΔH_f for the following reaction:",
    useDataBooklet: true,
    data: {
      reaction: "H₂(g) + I₂(s) → 2HI(g)",
      table: [
        {
          enthalpy: "ΔH_atom of I₂(s)",
          value: 107,
        },
        {
          enthalpy: "Bond Energy H-H",
        },
        {
          enthalpy: "Bond Energy H-I",
        },
      ],
    },
    answerHessLaw: "ΔH = D(H-H) + 2ΔH_atom[I₂(s)] - 2D(H-I)",
    expectedValue: "+52 kJ mol⁻¹",
  },
  {
    id: "q32",
    title: "L.E. of Calcium Chloride from Solution Data",
    instruction: "Using the data in the table below, draw an energy cycle to calculate ΔH for the following reaction:",
    data: {
      reaction: "Ca²⁺(g) + 2Cl⁻(g) → CaCl₂(s)",
      table: [
        {
          enthalpy: "ΔH_soln of CaCl₂(s)",
          value: -81,
        },
        {
          enthalpy: "ΔH_hyd of Ca²⁺(g)",
          value: -1650,
        },
        {
          enthalpy: "ΔH_hyd of Cl⁻(g)",
          value: -364,
        },
      ],
    },
    answerHessLaw: "L.E. of CaCl₂(s) = ΔH_hyd[Ca²⁺(g)] + 2ΔH_hyd[Cl⁻(g)] - ΔH_soln[CaCl₂(s)]",
    expectedValue: "-2297 kJ mol⁻¹",
  },
  {
    id: "q37",
    title: "Barium Reaction with Water",
    instruction: "Using the data in the table below, draw an energy cycle to calculate ΔH for the following reaction:",
    data: {
      reaction: "Ba(s) + 2H₂O(l) → Ba(OH)₂(aq) + H₂(g)",
      table: [
        {
          enthalpy: "ΔH_f of H₂O(l)",
          value: -286,
        },
        {
          enthalpy: "ΔH_f of Ba(OH)₂(s)",
          value: -964,
        },
        {
          enthalpy: "ΔH_soln of Ba(OH)₂(s)",
          value: -38,
        },
      ],
    },
    answerHessLaw: "ΔH = ΔH_f[Ba(OH)₂(s)] + ΔH_soln[Ba(OH)₂(s)] - 2ΔH_f[H₂O(l)]",
    expectedValue: "-430 kJ mol⁻¹",
  },
];
