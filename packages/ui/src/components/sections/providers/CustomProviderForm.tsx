import React from 'react';
import { SettingsSection } from '@/components/sections/shared/SettingsSection';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Icon } from '@/components/icon/Icon';
import { useI18n } from '@/lib/i18n';
import {
  createEmptyCustomProviderForm,
  createHeaderRow,
  createModelRow,
  validateCustomProvider,
  type CustomProviderFormState,
  type CustomProviderPersistPlan,
  type CustomProviderTranslator,
  type FieldErrors,
  type HeaderFieldErrors,
  type ModelFieldErrors,
} from './custom-provider-form';

const FIELD_LABEL_CLASS = 'typography-meta text-muted-foreground';
const HELPER_CLASS = 'typography-meta text-muted-foreground';
const ERROR_TEXT_CLASS = 'mt-1 typography-meta text-[var(--status-error)]';

type CustomProviderFormProps = {
  existingProviderIDs: ReadonlySet<string>;
  disabledProviders?: readonly string[];
  busy?: boolean;
  mode?: 'create' | 'edit';
  initialValues?: CustomProviderFormState;
  allowExistingAuth?: boolean;
  authFailureHint?: string | null;
  onSubmit: (plan: CustomProviderPersistPlan) => void | Promise<void>;
  onCancel?: () => void;
  onDisconnect?: () => void | Promise<void>;
};

export const CustomProviderForm: React.FC<CustomProviderFormProps> = ({
  existingProviderIDs,
  disabledProviders = [],
  busy = false,
  mode = 'create',
  initialValues,
  allowExistingAuth = false,
  authFailureHint = null,
  onSubmit,
  onCancel,
  onDisconnect,
}) => {
  const { t } = useI18n();
  const isEdit = mode === 'edit';
  const [form, setForm] = React.useState<CustomProviderFormState>(
    () => initialValues ?? createEmptyCustomProviderForm(),
  );
  const [err, setErr] = React.useState<FieldErrors>({});
  const [modelErrors, setModelErrors] = React.useState<ModelFieldErrors[]>([]);
  const [headerErrors, setHeaderErrors] = React.useState<HeaderFieldErrors[]>([]);

  React.useEffect(() => {
    if (initialValues) {
      setForm(initialValues);
      setErr({});
      setModelErrors([]);
      setHeaderErrors([]);
    }
  }, [initialValues]);

  const setField = (key: keyof Pick<CustomProviderFormState, 'providerID' | 'name' | 'baseURL' | 'apiKey'>, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setErr((prev) => ({ ...prev, [key]: undefined }));
  };

  const setModel = (index: number, key: 'id' | 'name', value: string) => {
    setForm((prev) => ({
      ...prev,
      models: prev.models.map((row, rowIndex) => (rowIndex === index ? { ...row, [key]: value } : row)),
    }));
    setModelErrors((prev) => {
      const next = [...prev];
      next[index] = { ...(next[index] ?? {}), [key]: undefined };
      return next;
    });
  };

  const setHeader = (index: number, key: 'key' | 'value', value: string) => {
    setForm((prev) => ({
      ...prev,
      headers: prev.headers.map((row, rowIndex) => (rowIndex === index ? { ...row, [key]: value } : row)),
    }));
    setHeaderErrors((prev) => {
      const next = [...prev];
      next[index] = { ...(next[index] ?? {}), [key]: undefined };
      return next;
    });
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) {
      return;
    }

    const output = validateCustomProvider({
      form,
      t: ((key, vars) => t(key as Parameters<typeof t>[0], vars)) as CustomProviderTranslator,
      existingProviderIDs,
      disabledProviders,
      editingProviderID: isEdit ? form.providerID : undefined,
      allowExistingAuth: isEdit && allowExistingAuth,
    });
    setErr(output.err);
    setModelErrors(output.models);
    setHeaderErrors(output.headers);
    if (!output.result) {
      return;
    }
    await onSubmit(output.result);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <SettingsSection
        title={isEdit ? t('settings.providers.page.custom.editTitle') : t('settings.providers.page.custom.title')}
      >
        <p className={HELPER_CLASS}>{t('settings.providers.page.custom.description')}</p>

        {authFailureHint ? (
          <p className="typography-meta text-[var(--status-warning)]" role="status">
            {authFailureHint}
          </p>
        ) : null}

        <div className="space-y-1.5">
          <label className={FIELD_LABEL_CLASS}>
            {t('settings.providers.page.custom.field.providerID.label')}
          </label>
          <Input
            value={form.providerID}
            onChange={(event) => setField('providerID', event.target.value)}
            placeholder={t('settings.providers.page.custom.field.providerID.placeholder')}
            className="h-8 rounded-md px-3 font-mono text-xs"
            autoFocus={!isEdit}
            disabled={isEdit || busy}
            aria-invalid={Boolean(err.providerID)}
            aria-label={t('settings.providers.page.custom.field.providerID.label')}
          />
          <p className={HELPER_CLASS}>{t('settings.providers.page.custom.field.providerID.info')}</p>
          {err.providerID ? <p className={ERROR_TEXT_CLASS}>{err.providerID}</p> : null}
        </div>

        <div className="space-y-1.5">
          <label className={FIELD_LABEL_CLASS}>
            {t('settings.providers.page.custom.field.name.label')}
          </label>
          <Input
            value={form.name}
            onChange={(event) => setField('name', event.target.value)}
            placeholder={t('settings.providers.page.custom.field.name.placeholder')}
            className="h-8 rounded-md px-3"
            aria-invalid={Boolean(err.name)}
            aria-label={t('settings.providers.page.custom.field.name.label')}
          />
          <p className={HELPER_CLASS}>{t('settings.providers.page.custom.field.name.info')}</p>
          {err.name ? <p className={ERROR_TEXT_CLASS}>{err.name}</p> : null}
        </div>

        <div className="space-y-1.5">
          <label className={FIELD_LABEL_CLASS}>
            {t('settings.providers.page.custom.field.baseURL.label')}
          </label>
          <Input
            value={form.baseURL}
            onChange={(event) => setField('baseURL', event.target.value)}
            placeholder={t('settings.providers.page.custom.field.baseURL.placeholder')}
            className="h-8 rounded-md px-3 font-mono text-xs"
            aria-invalid={Boolean(err.baseURL)}
            aria-label={t('settings.providers.page.custom.field.baseURL.label')}
          />
          <p className={HELPER_CLASS}>{t('settings.providers.page.custom.field.baseURL.info')}</p>
          {err.baseURL ? <p className={ERROR_TEXT_CLASS}>{err.baseURL}</p> : null}
        </div>

        <div className="space-y-1.5">
          <label className={FIELD_LABEL_CLASS}>
            {t('settings.providers.page.custom.field.apiKey.label')}
          </label>
          <Input
            type="password"
            value={form.apiKey}
            onChange={(event) => setField('apiKey', event.target.value)}
            placeholder={
              isEdit && allowExistingAuth
                ? t('settings.providers.page.custom.field.apiKey.editPlaceholder')
                : t('settings.providers.page.custom.field.apiKey.placeholder')
            }
            className="h-8 rounded-md px-3 font-mono text-xs"
            aria-invalid={Boolean(err.apiKey)}
            aria-label={t('settings.providers.page.custom.field.apiKey.label')}
          />
          <p className={HELPER_CLASS}>
            {isEdit && allowExistingAuth
              ? t('settings.providers.page.custom.field.apiKey.editInfo')
              : t('settings.providers.page.custom.field.apiKey.info')}
          </p>
          {err.apiKey ? <p className={ERROR_TEXT_CLASS}>{err.apiKey}</p> : null}
        </div>
      </SettingsSection>

      <SettingsSection title={t('settings.providers.page.custom.models.title')}>
        <div className="space-y-4">
          {form.models.map((model, index) => (
            <div key={model.row} className="space-y-2 rounded-md border border-border/40 p-3">
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="space-y-1">
                    <label className={FIELD_LABEL_CLASS}>
                      {t('settings.providers.page.custom.models.idLabel')}
                    </label>
                    <Input
                      value={model.id}
                      onChange={(event) => setModel(index, 'id', event.target.value)}
                      placeholder={t('settings.providers.page.custom.models.idPlaceholder')}
                      className="h-8 rounded-md px-3 font-mono text-xs"
                      aria-label={t('settings.providers.page.custom.models.idLabel')}
                    />
                    {modelErrors[index]?.id ? (
                      <p className={ERROR_TEXT_CLASS}>{modelErrors[index]?.id}</p>
                    ) : null}
                  </div>
                  <div className="space-y-1">
                    <label className={FIELD_LABEL_CLASS}>
                      {t('settings.providers.page.custom.models.nameLabel')}
                    </label>
                    <Input
                      value={model.name}
                      onChange={(event) => setModel(index, 'name', event.target.value)}
                      placeholder={t('settings.providers.page.custom.models.namePlaceholder')}
                      className="h-8 rounded-md px-3"
                      aria-label={t('settings.providers.page.custom.models.nameLabel')}
                    />
                    {modelErrors[index]?.name ? (
                      <p className={ERROR_TEXT_CLASS}>{modelErrors[index]?.name}</p>
                    ) : null}
                  </div>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  disabled={form.models.length <= 1}
                  onClick={() => {
                    if (form.models.length <= 1) return;
                    setForm((prev) => ({
                      ...prev,
                      models: prev.models.filter((_, rowIndex) => rowIndex !== index),
                    }));
                    setModelErrors((prev) => prev.filter((_, rowIndex) => rowIndex !== index));
                  }}
                  aria-label={t('settings.providers.page.custom.models.remove')}
                >
                  <Icon name="delete-bin" className="size-4" />
                </Button>
              </div>
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            size="xs"
            onClick={() => {
              setForm((prev) => ({ ...prev, models: [...prev.models, createModelRow()] }));
              setModelErrors((prev) => [...prev, {}]);
            }}
          >
            {t('settings.providers.page.custom.models.add')}
          </Button>
        </div>
      </SettingsSection>

      <SettingsSection title={t('settings.providers.page.custom.headers.title')}>
        <p className={HELPER_CLASS}>{t('settings.providers.page.custom.headers.description')}</p>
        <div className="space-y-4">
          {form.headers.map((header, index) => (
            <div key={header.row} className="space-y-2 rounded-md border border-border/40 p-3">
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="space-y-1">
                    <label className={FIELD_LABEL_CLASS}>
                      {t('settings.providers.page.custom.headers.keyLabel')}
                    </label>
                    <Input
                      value={header.key}
                      onChange={(event) => setHeader(index, 'key', event.target.value)}
                      placeholder={t('settings.providers.page.custom.headers.keyPlaceholder')}
                      className="h-8 rounded-md px-3 font-mono text-xs"
                      aria-label={t('settings.providers.page.custom.headers.keyLabel')}
                    />
                    {headerErrors[index]?.key ? (
                      <p className={ERROR_TEXT_CLASS}>{headerErrors[index]?.key}</p>
                    ) : null}
                  </div>
                  <div className="space-y-1">
                    <label className={FIELD_LABEL_CLASS}>
                      {t('settings.providers.page.custom.headers.valueLabel')}
                    </label>
                    <Input
                      value={header.value}
                      onChange={(event) => setHeader(index, 'value', event.target.value)}
                      placeholder={t('settings.providers.page.custom.headers.valuePlaceholder')}
                      className="h-8 rounded-md px-3 font-mono text-xs"
                      aria-label={t('settings.providers.page.custom.headers.valueLabel')}
                    />
                    {headerErrors[index]?.value ? (
                      <p className={ERROR_TEXT_CLASS}>{headerErrors[index]?.value}</p>
                    ) : null}
                  </div>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  disabled={form.headers.length <= 1}
                  onClick={() => {
                    if (form.headers.length <= 1) return;
                    setForm((prev) => ({
                      ...prev,
                      headers: prev.headers.filter((_, rowIndex) => rowIndex !== index),
                    }));
                    setHeaderErrors((prev) => prev.filter((_, rowIndex) => rowIndex !== index));
                  }}
                  aria-label={t('settings.providers.page.custom.headers.remove')}
                >
                  <Icon name="delete-bin" className="size-4" />
                </Button>
              </div>
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            size="xs"
            onClick={() => {
              setForm((prev) => ({ ...prev, headers: [...prev.headers, createHeaderRow()] }));
              setHeaderErrors((prev) => [...prev, {}]);
            }}
          >
            {t('settings.providers.page.custom.headers.add')}
          </Button>
        </div>
      </SettingsSection>

      <div className="flex flex-wrap items-center gap-2 py-2">
        {onCancel ? (
          <Button type="button" variant="outline" size="xs" onClick={onCancel} disabled={busy}>
            {t('settings.providers.page.custom.actions.back')}
          </Button>
        ) : null}
        {onDisconnect ? (
          <Button
            type="button"
            variant="destructive"
            size="xs"
            onClick={() => void onDisconnect()}
            disabled={busy}
          >
            {t('settings.providers.page.actions.disconnect')}
          </Button>
        ) : null}
        <Button type="submit" size="xs" disabled={busy}>
          {busy
            ? t('settings.providers.page.actions.saving')
            : isEdit
              ? t('settings.providers.page.custom.actions.update')
              : t('settings.providers.page.custom.actions.save')}
        </Button>
      </div>
    </form>
  );
};
