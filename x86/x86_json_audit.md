# x86.json — Audit / Fix Checklist

Scope: `x86.json` (3,899 instruction forms). Fix against authoritative Intel/AMD sources; **do not blindly infer validity or semantics**. Preserve existing IDs where possible.

## Issues

1. **Invalid mode metadata**
   - `vmxon_m64`: `modes.real = true` (incorrect).
   - `vpgatherdd_*`: `modes.real = true` (suspect; verify mode/state constraints).
   - Audit all forms' `real`, `protected`, `compat_32`, `long_64` values against SDM/APM. Distinguish instruction encoding legality from CPUID, CR0/CR4, XCR0, CPL, and runtime prerequisites.

2. **Malformed ISA extension groups**
   - Inspect/fix: `Both`, `Q`, `flags`, `EAX[5]`, `EAX[6]`, `AVX512D`, `VX512DQ`.
   - These appear to be source-parser artifacts or typos, not canonical ISA extension names. Correct source extraction, normalize feature identifiers, and update instruction group references. Do not relabel unknowns without evidence.

3. **Incorrect / imprecise implicit operands**
   - `cmpxchg_rm8_r8` and `cmpxchg_r_r8` list both `AL` and `AX` as implicit reads; 8-bit CMPXCHG uses `AL` (with conditional accumulator write on failure).
   - Audit implicit register width, read/write roles, conditional writes, and redundant overlapping aliases across all forms (including `AAA`).

4. **Incomplete semantic metadata**
   - **1,182 / 3,899** forms have neither `description` nor `pseudocode` (may still have `summary`).
   - Identify families with no detailed semantics; backfill from verified sources. Reuse semantics across size forms only when behavior is equivalent.
   - Also audit absent `exceptions`, `flags`, and implicit operands; absence may be legitimate and must not automatically be treated as a defect.

5. **Potential VEX/EVEX prefix double-counting**
   - VEX forms (e.g. `vpgatherdd_xmm_m_xmm`) have `mandatory_prefix: "66"` **and** `vex.pp: "66"`.
   - Clarify schema: `mandatory_prefix` is a semantic selector, not an extra emitted legacy prefix for VEX/EVEX encodings. Ensure the UI/byte renderer never draws an extra physical `66`/`F2`/`F3` byte. Check encoding generation and display.

6. **Stale source coverage / missing modern extensions**
   - Main Felix snapshot: Intel SDM Dec 2023; AMD APM revisions are older.
   - Audit modern ISA additions (particularly **APX** and **AVX10**) against current official specifications. Record source versions and document unsupported extensions; don't assume completeness from mnemonic counts.

## Validation / Acceptance

- Automated schema checks: unique IDs; valid group references; canonical ISA names; allowed enums/types; all four mode fields.
- Encoding cross-check against Intel XED and AMD documentation, including opcode maps, prefixes, ModR/M, operand sizes and mode restrictions.
- Report coverage **per instruction family and form**: encoding, operands, description, pseudocode, flags, exceptions, provenance; classify *missing* vs *not applicable*.
- Regression-test known examples above and flag any changes without source evidence.
- Produce a short before/after audit with counts of corrected records, remaining unknowns, and source links.
