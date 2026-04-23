import { useEffect, useState, useRef } from 'react';
import { 
  ChevronRight, 
  CheckCircle2, 
  XCircle,
  Loader2, 
  FlaskConical, 
  Info, 
  Library,
  ChevronLeft,
  Maximize2,
  Minimize2,
  Eye,
  EyeOff,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import DrawingCanvas, { DrawingCanvasRef, DrawingCanvasSnapshot, TemplateLayout } from './components/DrawingCanvas';
import { QUESTIONS } from './constants';
import { checkStudentWork } from './services/aiService';
import { Feedback, Question } from './types';

const decodeChemistryText = (value: string) => {
  return value
    .replaceAll('Î”', '\u0394')
    .replaceAll('Î£', '\u03A3')
    .replaceAll('â†’', '\u2192')
    .replaceAll('â‰¡', '\u2261')
    .replaceAll('Â½', '\u00BD')
    .replaceAll('Â²', '\u00B2')
    .replaceAll('Â³', '\u00B3')
    .replaceAll('âº', '\u207A')
    .replaceAll('â»', '\u207B')
    .replaceAll('â‚‚', '\u2082')
    .replaceAll('â‚ƒ', '\u2083')
    .replaceAll('â‚„', '\u2084')
    .replaceAll('â‚…', '\u2085')
    .replaceAll('â‚†', '\u2086')
    .replaceAll('â‚ˆ', '\u2088')
    .replaceAll('â‚â‚€', '\u2081\u2080')
    .replaceAll('â»Â¹', '\u207B\u00B9')
    .replaceAll('Â²âº', '\u00B2\u207A')
    .replaceAll('Â²â»', '\u00B2\u207B')
    .replaceAll('Â³âº', '\u00B3\u207A');
};
const DISPLAY_FRACTIONS: Array<[string, string]> = [
  ['7/8', '⅞'],
  ['5/8', '⅝'],
  ['3/8', '⅜'],
  ['1/8', '⅛'],
  ['3/4', '¾'],
  ['1/4', '¼'],
  ['2/3', '⅔'],
  ['1/3', '⅓'],
  ['1/2', '½'],
];

const ChemistryText = ({ children, className = "" }: { children: string; className?: string }) => {
  if (!children) return null;

  const decoded = decodeChemistryText(children);
  const parts = decoded.split(/(\u0394H(?:_[A-Za-z0-9()+-]+)?|Cl|Al|\(l\))/g);

  return (
    <span className={className}>
      {parts.map((part, i) => {
        if (part.startsWith('\u0394H')) {
          const subscript = part.slice(2).replace(/^_/, '');
          return (
            <span key={i}>
              <i className="font-sans italic not-italic">{'\u0394H'}</i>
              {subscript ? <sub className="font-sans not-italic">{subscript}</sub> : null}
            </span>
          );
        }
        if (part === 'Cl') return <span key={i}>C<i className="font-sans italic not-italic">l</i></span>;
        if (part === 'Al') return <span key={i}>A<i className="font-sans italic not-italic">l</i></span>;
        if (part === '(l)') return <span key={i}>(<i className="font-sans italic not-italic">l</i>)</span>;
        return <span key={i}>{part}</span>;
      })}
    </span>
  );
};

const formatEnthalpyValue = (value: number) => {
  return value > 0 ? `+${value}` : `${value}`;
};

const SUBSCRIPT_DIGITS: Record<string, string> = {
  '0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄',
  '5': '₅', '6': '₆', '7': '₇', '8': '₈', '9': '₉',
};

const SUPERSCRIPT_DIGITS: Record<string, string> = {
  '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴',
  '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹',
};

function formatEquationForDisplay(equation: string): string {
  let formatted = equation
    .replace(/->/g, ' → ')
    .replace(/\s{2,}/g, ' ');
  for (const [asciiFraction, prettyFraction] of DISPLAY_FRACTIONS) {
    const escapedFraction = asciiFraction.replace('/', '\\/');
    formatted = formatted.replace(
      new RegExp(`(^|[\\s+(])${escapedFraction}(?=\\s*[A-Za-z(])`, 'g'),
      `$1${prettyFraction}`
    );
  }

  return formatted
    .replace(/(^|[\s+(])(\d+)\/(\d+)(?=\s*[A-Za-z(])/g, (_, prefix, numerator, denominator) => {
      const numeratorSup = numerator.split('').map((d: string) => SUPERSCRIPT_DIGITS[d] ?? d).join('');
      const denominatorSub = denominator.split('').map((d: string) => SUBSCRIPT_DIGITS[d] ?? d).join('');
      return `${prefix}${numeratorSup}⁄${denominatorSub}`;
    })
    // Charges first: Mg2+ → Mg²⁺, Cl- → Cl⁻ (so the digit isn't mistaken for a formula subscript).
    .replace(/([A-Za-z)])(\d*)([+\-])(?=\(|\s|$|,|→)/g, (_, prefix, digits, sign) => {
      const digitSup = digits.split('').map((d: string) => SUPERSCRIPT_DIGITS[d] ?? d).join('');
      return prefix + digitSup + (sign === '+' ? '⁺' : '⁻');
    })
    // Formula subscripts: H2O → H₂O, MgCl2 → MgCl₂
    .replace(/([A-Za-z)])(\d+)(?=[A-Za-z()\s→]|$)/g, (_, prefix, digits) =>
      prefix + digits.split('').map((d: string) => SUBSCRIPT_DIGITS[d] ?? d).join('')
    );
}


function shortenComment(comment: string): string {
  const c = comment.toLowerCase();
  if (c.startsWith('balance check:')) {
    const match = comment.match(/"([^"]+)"/);
    return match ? `unbalanced: ${match[1]}` : 'unbalanced equation';
  }
  if (c.startsWith('extraction check:')) return 'unclear handwriting';
  if (c.includes('double-check')) return 'incorrectly labelled arrows';
  if (c === 'complete energy cycle') return 'complete energy cycle';
  if (c === 'incomplete energy cycle') return 'incomplete energy cycle';
  if (c.includes("missing application of hess")) return "missing application of Hess's Law";
  if (c.includes("incorrect application of hess")) return "incorrect application of Hess's Law";
  if (c.includes("correct application of hess")) return "correct application of Hess's Law";
  if (c.includes('missing calculated δh value') || c.includes('missing dh calculation') || c.includes('missing calculated dh')) return 'missing calculated ΔH value';
  if (c.includes('incorrect calculated δh value') || c.includes('incorrect calculated dh') || c.includes('incorrect calculated value of dh')) return 'incorrect calculated ΔH value';
  if (c.includes('correct calculated δh value') || c.includes('correct calculated dh') || c.includes('correct calculated value of dh')) return 'correct calculated ΔH value';
  const negative = c.includes('not ') || c.includes('miss') || c.includes('incorrect') || c.includes('no ') || c.includes('lack') || c.includes('double-check') || c.includes('incomplete');
  if (c.includes('state symbol')) return negative ? 'missing state symbols' : 'correct state symbols';
  if (c.includes('unbalanced') || (c.includes('balanced') && negative)) return 'unbalanced equations';
  if (c.includes('balanced')) return 'balanced equations';
  if (c.includes('label') || c.includes('arrow')) return negative ? 'incorrectly labelled arrows' : 'correctly labelled arrows';
  if (c.includes('hess') || (c.includes('cycle') && c.includes('construct'))) return negative ? "missing Hess's Law calculation" : 'correct cycle';
  return comment.length > 45 ? comment.slice(0, 42) + '...' : comment;
}

function isNegativeComment(comment: string): boolean {
  const c = comment.toLowerCase();
  return (
    c.startsWith('balance check:') ||
    c.startsWith('extraction check:') ||
    c === 'incomplete energy cycle' ||
    c.includes("missing application of hess") ||
    c.includes("incorrect application of hess") ||
    c.includes('missing calculated δh value') ||
    c.includes('incorrect calculated δh value') ||
    c.includes('not ') ||
    c.includes('miss') ||
    c.includes('incorrect') ||
    c.includes('incomplete') ||
    c.includes('no ') ||
    c.includes('lack') ||
    c.includes('double-check') ||
    c.includes('unbalanced')
  );
}

function statusTone(status: string) {
  if (status === 'correct' || status === 'complete') return 'positive';
  if (status === 'incorrect' || status === 'incomplete' || status === 'missing') return 'negative';
  return 'neutral';
}

function statusLabel(status: string) {
  if (status === 'correct') return 'Correct';
  if (status === 'incorrect') return 'Incorrect';
  if (status === 'missing') return 'Missing';
  if (status === 'complete') return 'Complete';
  if (status === 'incomplete') return 'Incomplete';
  return 'Uncertain';
}

export default function App() {
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [isChecking, setIsChecking] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isCanvasExpanded, setIsCanvasExpanded] = useState(false);
  const [canvasSnapshot, setCanvasSnapshot] = useState<DrawingCanvasSnapshot | null>(null);
  const [canvasDisplayScale, setCanvasDisplayScale] = useState(100);
  const [canvasTemplateLayout, setCanvasTemplateLayout] = useState<TemplateLayout>(3);
  const [hasStartedCanvas, setHasStartedCanvas] = useState(false);
  const [unlockedSuggestedAnswers, setUnlockedSuggestedAnswers] = useState<Record<string, boolean>>({});
  const [isSuggestedAnswerVisible, setIsSuggestedAnswerVisible] = useState(false);
  const canvasRef = useRef<DrawingCanvasRef>(null);

  const currentQuestion = QUESTIONS[currentQuestionIndex];
  const isSuggestedAnswerUnlocked = Boolean(unlockedSuggestedAnswers[currentQuestion.id]);
  const getSuggestedAnswerFinalLine = (question: typeof currentQuestion) => {
    if (question.expectedValue === "Comparison question") {
      return "Compare your theoretical bond-energy value with the experimental combustion value. The gap corresponds to benzene's extra stabilization from delocalization.";
    }

    return `Final answer: ${question.expectedValue}`;
  };

  const handleNextQuestion = () => {
    setCurrentQuestionIndex((prev) => (prev + 1) % QUESTIONS.length);
    handleClearCanvas();
    setFeedback(null);
    setError(null);
    setIsSuggestedAnswerVisible(false);
    setHasStartedCanvas(false);
  };

  const handlePrevQuestion = () => {
    setCurrentQuestionIndex((prev) => (prev - 1 + QUESTIONS.length) % QUESTIONS.length);
    handleClearCanvas();
    setFeedback(null);
    setError(null);
    setIsSuggestedAnswerVisible(false);
    setHasStartedCanvas(false);
  };

  const handleClearCanvas = () => {
    canvasRef.current?.clear();
    setCanvasSnapshot(null);
    setFeedback(null);
    setHasStartedCanvas(false);
  };

  const toggleCanvasExpanded = () => {
    const snapshot = canvasRef.current?.getSnapshot();
    if (snapshot) {
      setCanvasSnapshot(snapshot);
    }
    setIsCanvasExpanded((prev) => !prev);
  };

  const handleSubmitFromExpanded = async () => {
    if (!canvasRef.current) return;

    const imageData = canvasRef.current.getImageData();
    const analysisImages = canvasRef.current.getAnalysisImages();

    const snapshot = canvasRef.current.getSnapshot();
    if (snapshot) {
      setCanvasSnapshot(snapshot);
    }
    setIsCanvasExpanded(false);

    if (!imageData || imageData.length < 1000) {
      setError("Please draw your answer before checking.");
      return;
    }

    setIsChecking(true);
    setError(null);
    setFeedback(null);

    try {
      const result = await checkStudentWork(currentQuestion, imageData, analysisImages);
      setFeedback(result);
      setUnlockedSuggestedAnswers((previous) => ({
        ...previous,
        [currentQuestion.id]: true,
      }));
    } catch (err) {
      console.error(err);
      setError("Failed to analyze work. Please try again.");
    } finally {
      setIsChecking(false);
    }
  };

  const handleStartCanvas = () => {
    const snapshot = canvasRef.current?.getSnapshot();
    if (snapshot) {
      // Omit viewport so the expanded canvas focuses the template instead of restoring scroll position
      const { viewport: _viewport, ...rest } = snapshot;
      setCanvasSnapshot(rest);
    }
    setHasStartedCanvas(true);
    setIsCanvasExpanded(true);
  };

  useEffect(() => {
    if (!isCanvasExpanded) {
      return;
    }

    const timer = window.setTimeout(() => {
      canvasRef.current?.focusTemplate();
    }, 60);

    return () => {
      window.clearTimeout(timer);
    };
  }, [isCanvasExpanded]);

  const handleCheckWork = async () => {
    if (!canvasRef.current) return;
    
    const imageData = canvasRef.current.getImageData();
    const analysisImages = canvasRef.current.getAnalysisImages();
    if (!imageData || imageData.length < 1000) {
      setError("Please draw your answer before checking.");
      return;
    }

    setIsChecking(true);
    setError(null);
    setFeedback(null);

    try {
      const result = await checkStudentWork(currentQuestion, imageData, analysisImages);
      setFeedback(result);
      setUnlockedSuggestedAnswers((previous) => ({
        ...previous,
        [currentQuestion.id]: true,
      }));
    } catch (err) {
      console.error(err);
      setError("Failed to analyze work. Please try again.");
    } finally {
      setIsChecking(false);
    }
  };

  const visibleReferenceRows = currentQuestion.data.table.filter(
    (row) => row.value !== undefined || row.equation !== undefined
  );
  const summaryItems = feedback ? [
    { label: 'Energy cycle structure', status: feedback.summary.cycleStructure },
    { label: 'All equations balanced', status: feedback.summary.allEquationsBalanced },
    { label: 'State symbols', status: feedback.summary.stateSymbols },
    { label: 'Arrow labels / direction', status: feedback.summary.arrowLabelsAndDirection },
    { label: "Hess's Law calculation", status: feedback.summary.hessLaw },
    { label: 'Final ΔH value', status: feedback.summary.finalDeltaH },
  ] : [];

  return (
    <div className="app-shell min-h-screen bg-natural-bg text-natural-ink font-sans">
      {/* Header */}
      <header className="h-14 border-b border-natural-border bg-white/80 backdrop-blur-md sticky top-0 z-50 px-4 md:px-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-natural-olive rounded-lg text-white">
            <FlaskConical size={20} />
          </div>
          <div>
            <h1 className="font-bold text-base md:text-lg tracking-tight font-serif">Energy Cycle Practice</h1>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="hidden md:flex items-center gap-2 px-3 py-1 bg-natural-canvas border border-natural-border rounded-full text-[10px] font-bold text-natural-muted uppercase tracking-wider">
            <Library size={12} />
            Question {currentQuestionIndex + 1} of {QUESTIONS.length}
          </div>
          
          <button
            onClick={handleCheckWork}
            disabled={isChecking}
            className="flex items-center gap-2 px-6 py-2 bg-natural-green text-white rounded-lg font-semibold transition-all hover:opacity-90 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
          >
            {isChecking ? (
              <>
                <Loader2 size={18} className="animate-spin" />
                <span>Checking...</span>
              </>
            ) : (
              <>
                <CheckCircle2 size={18} />
                <span>Check Work</span>
              </>
            )}
          </button>
        </div>
      </header>

      <main className="flex flex-col lg:flex-row h-[calc(100vh-56px)] overflow-hidden">
        {/* Left Side: Question & Workspace */}
        <section className="flex-1 flex flex-col p-3 overflow-hidden border-r border-natural-border">
          {/* Compact Question Area */}
          <motion.div 
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            key={currentQuestion.id}
            className="flex flex-col gap-3 mb-3 bg-natural-canvas p-4 border border-natural-border rounded-xl shadow-sm"
          >
            <div className="flex justify-between items-start">
              <h2 className="text-sm font-sans text-natural-ink leading-relaxed pr-5">
                <span className="font-bold">Q{currentQuestionIndex + 1})</span> <ChemistryText className="font-normal">{currentQuestion.instruction}</ChemistryText>
                {currentQuestion.useDataBooklet && (
                  <p className="mt-1 text-natural-muted">
                    Use of the Data Booklet is relevant to this question
                  </p>
                )}
                <p className="mt-2 font-semibold text-natural-ink text-center">
                  <ChemistryText>{currentQuestion.data.reaction}</ChemistryText>
                </p>
              </h2>
              <div className="flex gap-2">
                <button onClick={handlePrevQuestion} className="p-1.5 bg-natural-bg border border-natural-border rounded-lg text-natural-muted hover:text-natural-ink transition-colors">
                  <ChevronLeft size={16} />
                </button>
                <button onClick={handleNextQuestion} className="p-1.5 bg-natural-bg border border-natural-border rounded-lg text-natural-muted hover:text-natural-ink transition-colors">
                  <ChevronRight size={16} />
                </button>
              </div>
            </div>
            
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 text-sm">
              {currentQuestion.data.table
                .filter(row => row.value !== undefined || row.equation !== undefined)
                .map((row, i) => (
                <div key={i} className="flex flex-col p-2.5 bg-white/50 rounded-lg border border-natural-border/30">
                  <div className="flex justify-between items-baseline gap-2">
                    <ChemistryText className="font-normal text-natural-ink">
                      {row.enthalpy}
                    </ChemistryText>
                    {row.value !== undefined && (
                      <span className="font-sans font-normal text-natural-olive whitespace-nowrap">
                        {formatEnthalpyValue(row.value)} <span className="text-[10px] opacity-80">kJ mol⁻¹</span>
                      </span>
                    )}
                  </div>
                  {row.equation && (
                    <div className="font-sans mt-1 pt-1 border-t border-natural-border/10 text-natural-muted">
                      <ChemistryText>{row.equation}</ChemistryText>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </motion.div>

          {/* Drawing Workspace - Maximized */}
          <div className="flex-1 min-h-0">
            {!isCanvasExpanded && (
              <div className="h-full flex flex-col gap-1.5 min-h-0">
                <div className="flex items-center justify-between px-2">
                  <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest font-black text-natural-muted">
                    Drawing Workspace
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-2 rounded-full border border-natural-border bg-white/90 px-2 py-1 shadow-sm">
                      <span className="text-[10px] font-black text-natural-muted">{canvasDisplayScale}%</span>
                      <input
                        type="range"
                        min={25}
                        max={150}
                        step={5}
                        value={canvasDisplayScale}
                        onChange={(event) => setCanvasDisplayScale(Number(event.target.value))}
                        className="warm-range w-28 md:w-36"
                        aria-label="Canvas preview scale"
                      />
                    </div>
                    <button
                      onClick={toggleCanvasExpanded}
                      className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest font-black text-natural-muted hover:text-natural-olive transition-colors"
                    >
                      <Maximize2 size={12} />
                      Expand
                    </button>
                  </div>
                </div>

                <div className="flex-1 relative min-h-0">
                  <DrawingCanvas
                    ref={canvasRef}
                    initialSnapshot={canvasSnapshot}
                    displayScale={canvasDisplayScale / 100}
                    templateLayout={canvasTemplateLayout}
                    onTemplateChange={setCanvasTemplateLayout}
                    onClear={handleClearCanvas}
                  />
                  {!hasStartedCanvas && (
                    <div className="absolute inset-0 z-20 flex items-center justify-center bg-white/72 backdrop-blur-[2px]">
                      <button
                        onClick={handleStartCanvas}
                        className="px-8 py-4 rounded-2xl bg-natural-olive text-white text-base font-black tracking-wide shadow-lg hover:opacity-90 transition-opacity"
                      >
                        Start
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </section>

        {/* Right Side: AI Feedback / Marking */}
        <aside className="w-full lg:w-[320px] bg-natural-panel lg:border-l border-natural-border p-4 flex flex-col overflow-y-auto">
          <div className="mb-4">
            <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-natural-muted mb-4 pb-2 border-b border-natural-border flex items-center justify-between">
              AI Marking Feedback
              <Info size={12} />
            </h3>

            {isSuggestedAnswerUnlocked && (
              <div className="mb-4">
                <button
                  onClick={() => setIsSuggestedAnswerVisible((previous) => !previous)}
                  className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-white border border-natural-border rounded-xl text-[11px] font-black uppercase tracking-widest text-natural-muted hover:text-natural-olive hover:border-natural-olive transition-colors"
                >
                  {isSuggestedAnswerVisible ? <EyeOff size={14} /> : <Eye size={14} />}
                  <span>{isSuggestedAnswerVisible ? "Hide Final Answer" : "Display Final Answer"}</span>
                </button>
              </div>
            )}

            <AnimatePresence mode="wait">
              {!feedback && !isChecking && !error && (
                <motion.div 
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="bg-white border border-natural-border p-6 rounded-xl text-center space-y-4"
                >
                  <div className="w-16 h-16 bg-natural-bg rounded-full flex items-center justify-center mx-auto border border-natural-border text-natural-olive">
                    <FlaskConical size={32} />
                  </div>
                  <h4 className="font-serif font-bold text-natural-ink italic">Ready for Review</h4>
                  <p className="text-sm text-natural-muted leading-relaxed">
                    Once you've constructed your diagram, construct your Hess's Law calculation and click <b>Check Work</b>.
                  </p>
                </motion.div>
              )}

              {!isChecking && !error && !feedback && isSuggestedAnswerUnlocked && isSuggestedAnswerVisible && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="bg-white border border-natural-border rounded-xl p-5 shadow-sm space-y-4"
                >
                  <div className="flex items-center justify-between pb-4 border-b border-natural-border/50">
                    <div className="text-[10px] font-black uppercase tracking-widest text-natural-muted">Suggested Answer</div>
                    <div className="px-2 py-0.5 bg-natural-olive/10 text-natural-olive text-[10px] font-black rounded uppercase">
                      Unlocked
                    </div>
                  </div>

                  <div className="space-y-3 text-sm leading-relaxed text-natural-ink">
                    <div>
                      <div className="text-[10px] font-black uppercase tracking-widest text-natural-muted mb-1">Hess's Law Setup</div>
                      <p className="font-serif italic text-natural-olive">
                        <ChemistryText>{currentQuestion.answerHessLaw}</ChemistryText>
                      </p>
                    </div>

                    <div>
                      <div className="text-[10px] font-black uppercase tracking-widest text-natural-muted mb-1">Answer</div>
                      <p className="font-semibold text-natural-ink">
                        <ChemistryText>{getSuggestedAnswerFinalLine(currentQuestion)}</ChemistryText>
                      </p>
                    </div>
                  </div>
                </motion.div>
              )}

              {isChecking && (
                <motion.div 
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="flex flex-col items-center justify-center py-20 text-center space-y-4"
                >
                  <Loader2 size={40} className="text-natural-olive animate-spin" />
                  <div className="space-y-1">
                    <p className="font-bold text-natural-ink">AI Teacher Marking...</p>
                    <p className="text-[10px] text-natural-muted uppercase font-bold tracking-widest">Validating state symbols</p>
                  </div>
                </motion.div>
              )}

              {error && (
                <motion.div 
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="bg-natural-bg border border-red-200 p-4 rounded-xl flex gap-3 text-red-800 text-sm"
                >
                  <Info className="flex-shrink-0" size={18} />
                  <p className="font-medium">{error}</p>
                </motion.div>
              )}

              {feedback && (
                <motion.div 
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="space-y-6"
                >
                  <div className="bg-white border border-natural-border rounded-xl p-5 shadow-sm">
                    <div className="mb-6 pb-4 border-b border-natural-border/50">
                      <div className="text-[10px] font-black uppercase tracking-widest text-natural-muted">Grade Report</div>
                    </div>

                    <div className="mb-6">
                      <div className="text-[11px] font-black uppercase tracking-widest text-natural-muted mb-3">
                        Extracted Equations:
                      </div>
                      <div className="space-y-1">
                        {feedback.reconstructedEquationChecks.map((entry, i) => (
                          <div key={i} className="rounded-lg border border-natural-border bg-white/70 px-3 py-2">
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <div className="text-[12px] font-serif italic text-natural-olive leading-relaxed">
                                  <ChemistryText>{formatEquationForDisplay(entry.equation)}</ChemistryText>
                                </div>
                                {entry.source !== 'explicit' && (
                                  <div className="mt-1 flex items-center gap-1.5 overflow-x-auto whitespace-nowrap pr-1">
                                    <span className="shrink-0 text-[10px] font-black uppercase tracking-widest text-natural-muted">
                                      Label:
                                    </span>
                                    {(entry.labelStatus === 'missing' || entry.hasCompleteLabel === false) && entry.missingLabelHint ? (
                                      <span className="shrink-0 text-[10px] font-mono text-red-700">
                                        missing <ChemistryText>{entry.missingLabelHint}</ChemistryText>
                                      </span>
                                    ) : entry.arrowLabel ? (
                                      <span className="shrink-0 text-[10px] font-mono text-natural-ink">
                                        <ChemistryText>{entry.arrowLabel}</ChemistryText>
                                      </span>
                                    ) : null}
                                    {(entry.labelStatus === 'missing' || entry.hasCompleteLabel === false) && !entry.missingLabelHint ? (
                                      <span className="shrink-0 text-[9px] font-black uppercase tracking-widest text-red-700 bg-red-100 px-1.5 py-0.5 rounded">no label</span>
                                    ) : entry.labelStatus === 'incorrect' ? (
                                      <span className="shrink-0 text-[9px] font-black uppercase tracking-widest text-red-700 bg-red-100 px-1.5 py-0.5 rounded">incorrect</span>
                                    ) : entry.labelStatus === 'correct' && entry.status !== 'unverifiable' ? (
                                      <span className="shrink-0 text-[9px] font-black uppercase tracking-widest text-green-700 bg-green-100 px-1.5 py-0.5 rounded">correct</span>
                                    ) : null}
                                  </div>
                                )}
                              </div>
                              <div className={`shrink-0 rounded px-1.5 py-0.5 text-[9px] font-black uppercase tracking-widest ${
                                entry.status === 'balanced'
                                  ? 'text-green-700 bg-green-100'
                                  : entry.status === 'unbalanced'
                                    ? 'text-red-700 bg-red-100'
                                    : 'text-amber-800 bg-amber-100'
                              }`}>
                                {entry.status === 'balanced'
                                  ? 'Balanced'
                                  : entry.status === 'unbalanced'
                                    ? 'Unbalanced'
                                    : entry.status === 'ignored'
                                      ? 'Ignored'
                                      : 'Unverifiable'}
                              </div>
                            </div>
                            {entry.issue && (
                              <p className={`mt-1 text-[11px] leading-relaxed ${
                                entry.status === 'unbalanced' ? 'text-red-700' : 'text-amber-800'
                              }`}>
                                {entry.issue}
                              </p>
                            )}
                            {entry.missingStateSpecies && entry.missingStateSpecies.length > 0 && (
                              <div className="mt-1 flex items-center gap-1.5 flex-wrap">
                                <span className="text-[10px] font-black uppercase tracking-widest text-red-600">
                                  Missing state symbol:
                                </span>
                                <span className="text-[11px] font-mono text-red-700">
                                  {entry.missingStateSpecies.join(', ')}
                                </span>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                      {feedback.reconstructedEquationChecks.length === 0 && (
                        <p className="text-[11px] text-natural-muted">
                          No arrow equations were confidently reconstructed from the drawing.
                        </p>
                      )}
                      {feedback.extractionNotes.length > 0 && (
                        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
                          <div className="text-[10px] font-black uppercase tracking-widest text-amber-700 mb-2">
                            Extraction Notes
                          </div>
                          <div className="space-y-1">
                            {feedback.extractionNotes.map((note, i) => (
                              <p key={i} className="text-[11px] leading-relaxed text-amber-800">
                                {note}
                              </p>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>

                    <div className="pt-4 border-t border-natural-border/50 space-y-3">
                      {summaryItems.map((item) => {
                        const tone = statusTone(item.status);
                        return (
                          <div key={item.label} className="flex gap-3 items-center">
                            {tone === 'positive' ? (
                              <CheckCircle2 className="flex-shrink-0 text-natural-green" size={20} />
                            ) : tone === 'negative' ? (
                              <XCircle className="flex-shrink-0 text-red-700" size={20} />
                            ) : (
                              <Info className="flex-shrink-0 text-amber-700" size={20} />
                            )}
                            <div className="min-w-0">
                              <p className="text-[13px] font-medium text-natural-ink">{item.label}</p>
                              <p className="text-[11px] uppercase tracking-widest text-natural-muted">{statusLabel(item.status)}</p>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {feedback.diagnostics.missingStateSpecies.length > 0 && (
                      <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2">
                        <div className="text-[10px] font-black uppercase tracking-widest text-red-700 mb-1">
                          State Symbol Gaps
                        </div>
                        <p className="text-[11px] leading-relaxed text-red-800">
                          {feedback.diagnostics.missingStateSpecies.join(', ')}
                        </p>
                      </div>
                    )}
                  </div>

                  {isSuggestedAnswerVisible && (
                    <div className="bg-white border border-natural-border rounded-xl p-5 shadow-sm space-y-4">
                      <div className="flex items-center justify-between pb-4 border-b border-natural-border/50">
                        <div className="text-[10px] font-black uppercase tracking-widest text-natural-muted">Suggested Answer</div>
                        <div className="px-2 py-0.5 bg-natural-olive/10 text-natural-olive text-[10px] font-black rounded uppercase">
                          Unlocked
                        </div>
                      </div>

                      <div className="space-y-3 text-sm leading-relaxed text-natural-ink">
                        <div>
                          <div className="text-[10px] font-black uppercase tracking-widest text-natural-muted mb-1">Hess's Law Setup</div>
                          <p className="font-serif italic text-natural-olive">
                            <ChemistryText>{currentQuestion.answerHessLaw}</ChemistryText>
                          </p>
                        </div>

                        <div>
                          <div className="text-[10px] font-black uppercase tracking-widest text-natural-muted mb-1">Answer</div>
                          <p className="font-semibold text-natural-ink">
                            <ChemistryText>{getSuggestedAnswerFinalLine(currentQuestion)}</ChemistryText>
                          </p>
                        </div>
                      </div>
                    </div>
                  )}

                  <button 
                    onClick={handleNextQuestion}
                    className="w-full flex items-center justify-center gap-2 py-3.5 bg-natural-olive text-white rounded-xl font-bold hover:opacity-90 transition-all shadow-md active:scale-95"
                  >
                    <span>NEXT CHALLENGE</span>
                    <ChevronRight size={18} />
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <div className="mt-auto pt-8 flex items-center justify-center">
             <div className="text-[10px] font-bold text-natural-muted uppercase tracking-[0.2em] opacity-50">
                Unit 4 • Level: A-Level
             </div>
          </div>
        </aside>
      </main>

      {isCanvasExpanded && (
        <div className="fixed inset-0 z-[60] bg-natural-bg/95 backdrop-blur-sm p-4 md:p-6">
          <div className="h-full max-w-7xl mx-auto flex flex-col gap-4">
            <div className="flex flex-col gap-2 bg-white/90 border border-natural-border rounded-2xl px-3 py-3 shadow-sm overflow-x-auto">
              <div className="flex items-stretch gap-2 min-w-max w-full">
                <div className="min-w-[280px] max-w-[280px] rounded-xl border border-natural-border/70 bg-natural-bg/70 px-3 py-2 flex flex-col justify-center shrink-0">
                  <div className="text-[10px] font-black uppercase tracking-[0.2em] text-natural-muted mb-1">
                    Whiteboard Focus Mode
                  </div>
                  <div className="text-sm font-semibold text-natural-ink leading-snug text-center">
                    <span className="block mb-1">Q{currentQuestionIndex + 1}</span>
                    <ChemistryText>{currentQuestion.data.reaction}</ChemistryText>
                  </div>
                </div>

                {visibleReferenceRows.map((row, i) => (
                  <div key={i} className="min-w-[170px] max-w-[220px] rounded-xl border border-natural-border/70 bg-natural-bg/70 px-2.5 py-2 flex flex-col shrink-0">
                    <div className="flex items-start justify-between gap-2 text-[10px] leading-snug text-natural-muted">
                      <ChemistryText className="font-semibold text-natural-ink">
                        {row.enthalpy}
                      </ChemistryText>
                      {row.value !== undefined && (
                        <span className="shrink-0 font-semibold text-natural-olive text-right">
                          {formatEnthalpyValue(row.value)} <span className="text-[9px] opacity-80">kJ mol⁻¹</span>
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-[10px] leading-snug text-natural-muted text-left break-words">
                      {row.equation ? <ChemistryText>{row.equation}</ChemistryText> : null}
                    </p>
                  </div>
                ))}

                <div className="flex flex-col items-start gap-2 self-start shrink-0 ml-auto">
                  <div className="flex items-center gap-2">
                    <div className="flex items-center gap-2 rounded-full border border-natural-border bg-white/90 px-2 py-1 shadow-sm">
                      <span className="text-[10px] font-black text-natural-muted">{canvasDisplayScale}%</span>
                      <input
                        type="range"
                        min={25}
                        max={150}
                        step={5}
                        value={canvasDisplayScale}
                        onChange={(event) => setCanvasDisplayScale(Number(event.target.value))}
                        className="warm-range w-28 md:w-36"
                        aria-label="Canvas focus scale"
                      />
                    </div>
                    <button
                      onClick={toggleCanvasExpanded}
                      aria-label="Return from whiteboard focus mode"
                      className="flex items-center justify-center w-10 h-10 bg-natural-olive text-white rounded-lg hover:opacity-90 transition-opacity"
                      title="Return"
                    >
                      <Minimize2 size={16} />
                    </button>
                  </div>
                  <button
                    onClick={handleSubmitFromExpanded}
                    className="flex items-center gap-2 px-5 py-2 bg-natural-green text-white rounded-lg font-semibold text-sm hover:opacity-90 active:scale-95 transition-all shadow-sm"
                  >
                    <CheckCircle2 size={16} />
                    <span>Submit Answer</span>
                  </button>
                </div>
              </div>
            </div>

            <div className="flex-1 min-h-0">
              <DrawingCanvas
                ref={canvasRef}
                initialSnapshot={canvasSnapshot}
                displayScale={canvasDisplayScale / 100}
                templateLayout={canvasTemplateLayout}
                onTemplateChange={setCanvasTemplateLayout}
                onClear={handleClearCanvas}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
