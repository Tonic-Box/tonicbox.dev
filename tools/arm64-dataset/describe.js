/**
 * Our own concise, factual descriptions for ARM mnemonics (acronym expansions are
 * facts, not Arm's copyrightable prose). Exact dictionary first, then conservative
 * modifier heuristics, then a class-name fallback. Returns { text, sourced } where
 * sourced=true means a real description (dict/heuristic), false means class fallback.
 */

/* Exact mnemonic -> description. Keep factual and short. */
var DICT = {
  // --- data processing: arithmetic ---
  ADD: "Add", ADDS: "Add and set condition flags", ADC: "Add with carry", ADCS: "Add with carry and set flags",
  SUB: "Subtract", SUBS: "Subtract and set condition flags", SBC: "Subtract with carry", SBCS: "Subtract with carry and set flags",
  NEG: "Negate", NEGS: "Negate and set condition flags", NGC: "Negate with carry", NGCS: "Negate with carry and set flags",
  CMP: "Compare", CMN: "Compare negative", ADDG: "Add with tag", SUBG: "Subtract with tag", SUBP: "Subtract pointer", SUBPS: "Subtract pointer and set flags",
  MUL: "Multiply", MNEG: "Multiply-negate", MADD: "Multiply-add", MSUB: "Multiply-subtract",
  SMULL: "Signed multiply long", UMULL: "Unsigned multiply long", SMNEGL: "Signed multiply-negate long", UMNEGL: "Unsigned multiply-negate long",
  SMADDL: "Signed multiply-add long", UMADDL: "Unsigned multiply-add long", SMSUBL: "Signed multiply-subtract long", UMSUBL: "Unsigned multiply-subtract long",
  SMULH: "Signed multiply high", UMULH: "Unsigned multiply high",
  SDIV: "Signed divide", UDIV: "Unsigned divide",
  // --- data processing: logical / move ---
  AND: "Bitwise AND", ANDS: "Bitwise AND and set flags", ORR: "Bitwise OR", ORN: "Bitwise OR NOT",
  EOR: "Bitwise exclusive-OR", EON: "Bitwise exclusive-OR NOT", BIC: "Bitwise bit clear", BICS: "Bitwise bit clear and set flags",
  TST: "Test bits", TEQ: "Test equivalence",
  MOV: "Move", MOVZ: "Move wide with zero", MOVN: "Move wide with NOT", MOVK: "Move wide with keep", MVN: "Bitwise NOT (move negated)",
  LSL: "Logical shift left", LSR: "Logical shift right", ASR: "Arithmetic shift right", ROR: "Rotate right", RRX: "Rotate right with extend",
  LSLV: "Logical shift left variable", LSRV: "Logical shift right variable", ASRV: "Arithmetic shift right variable", RORV: "Rotate right variable",
  // --- bitfield / bit manipulation ---
  BFM: "Bitfield move", SBFM: "Signed bitfield move", UBFM: "Unsigned bitfield move",
  BFI: "Bitfield insert", BFC: "Bitfield clear", BFXIL: "Bitfield extract and insert low", SBFIZ: "Signed bitfield insert in zeros", UBFIZ: "Unsigned bitfield insert in zeros",
  SBFX: "Signed bitfield extract", UBFX: "Unsigned bitfield extract", EXTR: "Extract register (concatenate and shift)",
  SXTB: "Sign-extend byte", SXTH: "Sign-extend halfword", SXTW: "Sign-extend word", UXTB: "Zero-extend byte", UXTH: "Zero-extend halfword",
  CLZ: "Count leading zeros", CLS: "Count leading sign bits", RBIT: "Reverse bit order", CTZ: "Count trailing zeros", CNT: "Count bits set",
  REV: "Reverse byte order", REV16: "Reverse bytes in halfwords", REV32: "Reverse bytes in words", REV64: "Reverse byte order (64-bit)",
  // --- conditional select / compare ---
  CSEL: "Conditional select", CSINC: "Conditional select increment", CSINV: "Conditional select invert", CSNEG: "Conditional select negate",
  CSET: "Conditional set", CSETM: "Conditional set mask", CINC: "Conditional increment", CINV: "Conditional invert", CNEG: "Conditional negate",
  CCMP: "Conditional compare", CCMN: "Conditional compare negative",
  // --- address ---
  ADR: "Form PC-relative address", ADRP: "Form PC-relative address to 4KB page",
  // --- branches ---
  B: "Branch", BL: "Branch with link", BR: "Branch to register", BLR: "Branch with link to register", RET: "Return from subroutine",
  CBZ: "Compare and branch if zero", CBNZ: "Compare and branch if nonzero", TBZ: "Test bit and branch if zero", TBNZ: "Test bit and branch if nonzero",
  BC: "Branch consistent (conditionally)", RETAA: "Return, authenticating with key A", RETAB: "Return, authenticating with key B",
  BRAA: "Branch to register, authenticating with key A", BRAB: "Branch to register, authenticating with key B",
  BLRAA: "Branch with link to register, authenticating with key A", BLRAB: "Branch with link to register, authenticating with key B",
  // --- loads / stores ---
  LDR: "Load register", LDRB: "Load register byte", LDRH: "Load register halfword", LDRSB: "Load register signed byte", LDRSH: "Load register signed halfword", LDRSW: "Load register signed word",
  STR: "Store register", STRB: "Store register byte", STRH: "Store register halfword",
  LDUR: "Load register (unscaled offset)", LDURB: "Load byte (unscaled)", LDURH: "Load halfword (unscaled)", LDURSB: "Load signed byte (unscaled)", LDURSH: "Load signed halfword (unscaled)", LDURSW: "Load signed word (unscaled)",
  STUR: "Store register (unscaled offset)", STURB: "Store byte (unscaled)", STURH: "Store halfword (unscaled)",
  LDP: "Load pair of registers", STP: "Store pair of registers", LDPSW: "Load pair of signed words", LDNP: "Load pair, non-temporal", STNP: "Store pair, non-temporal",
  LDTR: "Load register (unprivileged)", STTR: "Store register (unprivileged)",
  LDAR: "Load-acquire register", STLR: "Store-release register", LDAXR: "Load-acquire exclusive register", STLXR: "Store-release exclusive register",
  LDXR: "Load exclusive register", STXR: "Store exclusive register", LDXP: "Load exclusive pair", STXP: "Store exclusive pair", LDAXP: "Load-acquire exclusive pair", STLXP: "Store-release exclusive pair",
  CAS: "Compare and swap", CASA: "Compare and swap, acquire", CASL: "Compare and swap, release", CASAL: "Compare and swap, acquire-release",
  CASP: "Compare and swap pair", SWP: "Swap", SWPA: "Swap, acquire", SWPL: "Swap, release", SWPAL: "Swap, acquire-release",
  LDADD: "Atomic add", LDCLR: "Atomic bit clear", LDEOR: "Atomic exclusive-OR", LDSET: "Atomic bit set", LDSMAX: "Atomic signed maximum", LDSMIN: "Atomic signed minimum", LDUMAX: "Atomic unsigned maximum", LDUMIN: "Atomic unsigned minimum",
  STADD: "Atomic add (no return)", STCLR: "Atomic bit clear (no return)", STEOR: "Atomic exclusive-OR (no return)", STSET: "Atomic bit set (no return)",
  PRFM: "Prefetch memory", PRFUM: "Prefetch memory (unscaled)",
  // --- system / barriers / hints ---
  MRS: "Move system register to general register", MSR: "Move general register to system register",
  SVC: "Supervisor call", HVC: "Hypervisor call", SMC: "Secure monitor call", BRK: "Breakpoint", HLT: "Halt", ERET: "Exception return",
  NOP: "No operation", YIELD: "Yield hint", WFE: "Wait for event", WFI: "Wait for interrupt", SEV: "Send event", SEVL: "Send event local",
  ISB: "Instruction synchronization barrier", DSB: "Data synchronization barrier", DMB: "Data memory barrier", ESB: "Error synchronization barrier",
  CLREX: "Clear exclusive monitor", DC: "Data cache maintenance", IC: "Instruction cache maintenance", AT: "Address translate", TLBI: "TLB invalidate",
  SYS: "System instruction", SYSL: "System instruction with result", MSRR: "Move general registers to system register (pair)", MRRS: "Move system register to general registers (pair)",
  PACIA: "Pointer authentication code, instruction, key A", PACIB: "Pointer authentication code, instruction, key B",
  PACDA: "Pointer authentication code, data, key A", PACDB: "Pointer authentication code, data, key B",
  AUTIA: "Authenticate instruction address, key A", AUTIB: "Authenticate instruction address, key B", XPACD: "Strip pointer authentication code, data", XPACI: "Strip pointer authentication code, instruction",
  // --- floating-point ---
  FMOV: "Floating-point move", FADD: "Floating-point add", FSUB: "Floating-point subtract", FMUL: "Floating-point multiply", FDIV: "Floating-point divide",
  FNMUL: "Floating-point multiply-negate", FMADD: "Floating-point fused multiply-add", FMSUB: "Floating-point fused multiply-subtract",
  FNMADD: "Floating-point negated fused multiply-add", FNMSUB: "Floating-point negated fused multiply-subtract",
  FABS: "Floating-point absolute value", FNEG: "Floating-point negate", FSQRT: "Floating-point square root",
  FCMP: "Floating-point compare", FCMPE: "Floating-point compare (with exceptions)", FCCMP: "Floating-point conditional compare", FCCMPE: "Floating-point conditional compare (with exceptions)",
  FCSEL: "Floating-point conditional select", FMAX: "Floating-point maximum", FMIN: "Floating-point minimum", FMAXNM: "Floating-point maximum number", FMINNM: "Floating-point minimum number",
  FCVT: "Floating-point convert precision", FCVTZS: "Floating-point convert to signed integer (round toward zero)", FCVTZU: "Floating-point convert to unsigned integer (round toward zero)",
  FCVTAS: "Floating-point convert to signed integer (round to nearest, ties away)", FCVTAU: "Floating-point convert to unsigned integer (round to nearest, ties away)",
  FCVTMS: "Floating-point convert to signed integer (round toward minus infinity)", FCVTMU: "Floating-point convert to unsigned integer (round toward minus infinity)",
  FCVTNS: "Floating-point convert to signed integer (round to nearest)", FCVTNU: "Floating-point convert to unsigned integer (round to nearest)",
  FCVTPS: "Floating-point convert to signed integer (round toward plus infinity)", FCVTPU: "Floating-point convert to unsigned integer (round toward plus infinity)",
  SCVTF: "Signed integer convert to floating-point", UCVTF: "Unsigned integer convert to floating-point",
  FRINTN: "Floating-point round to integral (nearest)", FRINTP: "Floating-point round to integral (plus infinity)", FRINTM: "Floating-point round to integral (minus infinity)",
  FRINTZ: "Floating-point round to integral (toward zero)", FRINTA: "Floating-point round to integral (nearest, ties away)", FRINTX: "Floating-point round to integral exact", FRINTI: "Floating-point round to integral (current mode)",
  // --- CRC / crypto ---
  CRC32B: "CRC-32 checksum over byte", CRC32H: "CRC-32 checksum over halfword", CRC32W: "CRC-32 checksum over word", CRC32X: "CRC-32 checksum over doubleword",
  CRC32CB: "CRC-32C checksum over byte", CRC32CH: "CRC-32C checksum over halfword", CRC32CW: "CRC-32C checksum over word", CRC32CX: "CRC-32C checksum over doubleword",
  AESE: "AES single-round encryption", AESD: "AES single-round decryption", AESMC: "AES mix columns", AESIMC: "AES inverse mix columns",
  PMULL: "Polynomial multiply long", PMULL2: "Polynomial multiply long (upper half)",
  // --- misc data movement ---
  EXT: "Extract vector from pair", DUP: "Duplicate element to vector", INS: "Insert vector element", UMOV: "Unsigned move vector element to general register", SMOV: "Signed move vector element to general register",
  ZIP1: "Zip vectors (primary)", ZIP2: "Zip vectors (secondary)", UZP1: "Unzip vectors (primary)", UZP2: "Unzip vectors (secondary)", TRN1: "Transpose vectors (primary)", TRN2: "Transpose vectors (secondary)",
  TBL: "Table vector lookup", TBX: "Table vector lookup with fallback",
  // --- SIMD vector (NEON / shared) ---
  ABS: "Absolute value", SQABS: "Saturating absolute value", SQNEG: "Saturating negate", NOT: "Bitwise NOT",
  MLA: "Multiply-add", MLS: "Multiply-subtract", SMLAL: "Signed multiply-add long", UMLAL: "Unsigned multiply-add long", SMLSL: "Signed multiply-subtract long", UMLSL: "Unsigned multiply-subtract long",
  ADDP: "Add pairwise", ADDV: "Add across vector", SADDLV: "Signed add long across vector", UADDLV: "Unsigned add long across vector", SADDLP: "Signed add long pairwise", UADDLP: "Unsigned add long pairwise",
  SADDL: "Signed add long", UADDL: "Unsigned add long", SADDW: "Signed add wide", UADDW: "Unsigned add wide", SSUBL: "Signed subtract long", USUBL: "Unsigned subtract long", SSUBW: "Signed subtract wide", USUBW: "Unsigned subtract wide",
  SMAX: "Signed maximum", UMAX: "Unsigned maximum", SMIN: "Signed minimum", UMIN: "Unsigned minimum", SMAXP: "Signed maximum pairwise", UMAXP: "Unsigned maximum pairwise", SMINP: "Signed minimum pairwise", UMINP: "Unsigned minimum pairwise",
  SMAXV: "Signed maximum across vector", UMAXV: "Unsigned maximum across vector", SMINV: "Signed minimum across vector", UMINV: "Unsigned minimum across vector",
  SABD: "Signed absolute difference", UABD: "Unsigned absolute difference", SABA: "Signed absolute difference and accumulate", UABA: "Unsigned absolute difference and accumulate", SABDL: "Signed absolute difference long", UABDL: "Unsigned absolute difference long",
  CMEQ: "Compare bitwise equal", CMGT: "Compare signed greater than", CMGE: "Compare signed greater than or equal", CMHI: "Compare unsigned higher", CMHS: "Compare unsigned higher or same", CMLT: "Compare signed less than zero", CMLE: "Compare signed less than or equal to zero", CMTST: "Compare bitwise test bits nonzero",
  BSL: "Bitwise select", BIT: "Bitwise insert if true", BIF: "Bitwise insert if false",
  SHL: "Shift left", SSHR: "Signed shift right", USHR: "Unsigned shift right", SSHL: "Signed shift left", USHL: "Unsigned shift left", SRSHR: "Signed rounding shift right", URSHR: "Unsigned rounding shift right",
  SLI: "Shift left and insert", SRI: "Shift right and insert", SSRA: "Signed shift right and accumulate", USRA: "Unsigned shift right and accumulate", SHRN: "Shift right narrow", SQSHL: "Signed saturating shift left", UQSHL: "Unsigned saturating shift left",
  SQADD: "Signed saturating add", UQADD: "Unsigned saturating add", SQSUB: "Signed saturating subtract", UQSUB: "Unsigned saturating subtract", SUQADD: "Signed saturating accumulate of unsigned", USQADD: "Unsigned saturating accumulate of signed",
  XTN: "Extract narrow", SQXTN: "Signed saturating extract narrow", UQXTN: "Unsigned saturating extract narrow", SQXTUN: "Signed saturating extract unsigned narrow", SXTL: "Signed extend long", UXTL: "Unsigned extend long",
  MOVI: "Move immediate (vector)", MVNI: "Move inverted immediate (vector)", FMLA: "Floating-point fused multiply-add", FMLS: "Floating-point fused multiply-subtract",
  FADDP: "Floating-point add pairwise", FMAXP: "Floating-point maximum pairwise", FMINP: "Floating-point minimum pairwise", FMAXV: "Floating-point maximum across vector", FMINV: "Floating-point minimum across vector",
  FRECPE: "Floating-point reciprocal estimate", FRSQRTE: "Floating-point reciprocal square-root estimate", FRECPS: "Floating-point reciprocal step", FRSQRTS: "Floating-point reciprocal square-root step", FRECPX: "Floating-point reciprocal exponent",
  LD1: "Load multiple single-element structures (1 register)", LD2: "Load 2-element structures", LD3: "Load 3-element structures", LD4: "Load 4-element structures",
  ST1: "Store multiple single-element structures (1 register)", ST2: "Store 2-element structures", ST3: "Store 3-element structures", ST4: "Store 4-element structures",
  LD1R: "Load single-element and replicate", LD2R: "Load 2-element and replicate", LD3R: "Load 3-element and replicate", LD4R: "Load 4-element and replicate",
  // --- SVE / SVE2 (common) ---
  PTRUE: "Initialise predicate (true elements)", PTRUES: "Initialise predicate (true) and set flags", PFALSE: "Set predicate to all-false", PTEST: "Set condition flags from predicate", SEL: "Conditionally select elements by predicate",
  WHILELT: "Create predicate: while incrementing signed less-than", WHILELE: "While incrementing signed less-or-equal", WHILELO: "While incrementing unsigned lower-than", WHILELS: "While incrementing unsigned lower-or-same",
  MOVPRFX: "Move prefix (constructive operation)", INDEX: "Create index vector (base + step)", PRFB: "Prefetch bytes", PRFH: "Prefetch halfwords", PRFW: "Prefetch words", PRFD: "Prefetch doublewords",
  CNTB: "Count active bytes in vector length", CNTH: "Count active halfwords", CNTW: "Count active words", CNTD: "Count active doublewords", CNTP: "Count active predicate elements",
  RDVL: "Read vector length into register", ADDVL: "Add multiple of vector length", ADDPL: "Add multiple of predicate length", RDFFR: "Read first-fault register", SETFFR: "Set first-fault register", WRFFR: "Write first-fault register",
  LASTA: "Extract element after last active", LASTB: "Extract last active element", CLASTA: "Conditionally extract element after last active", CLASTB: "Conditionally extract last active element",
  SPLICE: "Splice two vectors under predicate", COMPACT: "Pack active elements", REV: "Reverse byte order", REVB: "Reverse bytes within elements", REVH: "Reverse halfwords within elements", REVW: "Reverse words within elements",
  ANDV: "AND reduction across vector", ORV: "OR reduction across vector", EORV: "Exclusive-OR reduction across vector", SMAXQV: "Signed maximum reduction", INCB: "Increment by vector length (bytes)", DECB: "Decrement by vector length (bytes)",
  // --- SME (common) ---
  ZERO: "Zero ZA tile or slice", SMSTART: "Enable Streaming SVE and/or ZA", SMSTOP: "Disable Streaming SVE and/or ZA", MOPA: "Matrix outer product and accumulate", MOPS: "Matrix outer product and subtract"
};

/* Prefix/root heuristics applied when no exact match. Conservative. */
function heuristic(mn) {
  var m = mn.toUpperCase();
  // Floating-point / SIMD scalar sharing a base with an integer op
  if (m[0] === "F" && DICT[m.slice(1)]) return "Floating-point " + lower(DICT[m.slice(1)]);
  // AArch32 NEON vector mnemonics: V<base>
  if (m[0] === "V" && DICT[m.slice(1)]) return "Vector " + lower(DICT[m.slice(1)]);
  // signed/unsigned saturating/rounding families share a base verb
  var m2 = m.replace(/^(SQ|UQ|SR|UR|S|U)/, "");
  if (m2 !== m && DICT[m2]) return DICT[m2];
  return null;
}
function lower(s) { return s.charAt(0).toLowerCase() + s.slice(1); }

function describe(mnemonic, className) {
  var m = (mnemonic || "").toUpperCase();
  if (DICT[m]) return { text: DICT[m], sourced: true };
  var h = heuristic(m);
  if (h) return { text: h, sourced: true };
  return { text: (className ? className + " instruction" : "ARM instruction"), sourced: false };
}

module.exports = { describe: describe };
