import type { I18nKey } from './en';

/**
 * Dutch (nl) — spine S7 seed (upstream added the locale in `de319de21`).
 *
 * Carries only the keys this batch introduced (the v2 typed-form surfaces and
 * the locale label). Unlisted keys fall back to English per-key in
 * `formatMessage`; the full dictionary lands with the B10 i18n batch.
 */
export const dict: Partial<Record<I18nKey, string>> = {
  'common.language.dutch': 'Nederlands',
  'chat.formCard.inputNeeded': 'Invoer nodig',
  'chat.formCard.fromSubagent': 'van een subagent',
  'chat.formCard.required': 'Verplicht',
  'chat.formCard.openLink': 'Link openen',
  'chat.formCard.yes': 'Ja',
  'chat.formCard.other': 'Anders',
  'chat.formCard.yourAnswer': 'Uw antwoord',
  'chat.formCard.submit': 'Versturen',
  'chat.formCard.cancel': 'Annuleren',
  'chat.formCard.missingRequired': 'Vul eerst de verplichte velden in.',
  'chat.formCard.submitFailed': 'Kan het antwoord niet versturen',
  'chat.formCard.cancelFailed': 'Kan het verzoek niet annuleren',
  'chat.formCard.tryAgain': 'Probeer het opnieuw.',
  'chat.formDock.progress': '{current} van {total}',
  'chat.formDock.waiting': 'nog {count} in de wachtrij',
  'chat.formDock.back': 'Terug',
  'chat.formDock.expandAria': 'Vraag uitklappen',
  'chat.formDock.collapseAria': 'Vraag inklappen',
  'chat.formDock.stepAria': 'Vraag {index}: {title}',
  'chat.formDock.linkInfo': 'Open de link en ga dan verder.',
  'filesView.editor.symbols': 'Symbolen in bestand',
  'filesView.symbols.placeholder': 'Naar symbool…',
  'filesView.symbols.noneInFile': 'Geen functies, klassen of koppen gevonden in dit bestand',
  'filesView.symbols.noMatches': 'Geen overeenkomende symbolen',
  'filesView.tree.actions.showGitignored': 'Door git genegeerde bestanden tonen',
  'filesView.tree.actions.hideGitignored': 'Door git genegeerde bestanden verbergen',
};
