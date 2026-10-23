// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Priors…" sub-dialog for the Bayesian dialogs — SPSS keeps the prior behind
 * its own button rather than on the main page. Wraps BayesPriorSection with
 * local state so Cancel discards, and Continue stays off while a custom width
 * is invalid.
 */

import { useState } from 'react'
import { SubDialogFooter } from '../../components/Dialogs/AnalysisDialogShell'
import { BayesPriorSection } from './BayesPriorSection'
import { isCustomWidthValid, type BayesPrior, type PriorFamily } from './bayes-prior'

export function BayesPriorOptionsContent({
  prior,
  onChange,
  onClose,
  family
}: {
  prior: BayesPrior
  onChange: (p: BayesPrior) => void
  onClose: () => void
  family: PriorFamily
}) {
  const [local, setLocal] = useState(prior)
  const customBad = local.preset === 'custom' && !isCustomWidthValid(local)

  return (
    <>
      <BayesPriorSection prior={local} setPrior={setLocal} family={family} />
      <SubDialogFooter
        continueDisabled={customBad}
        onContinue={() => {
          onChange(local)
          onClose()
        }}
        onCancel={onClose}
      />
    </>
  )
}
