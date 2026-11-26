import React, { useState } from 'react';
import { useWallet } from '../hooks/useWallet';
import { useContractCall } from '../hooks/useContractCall';

type WizardStep = 'wallet' | 'details' | 'confirm' | 'success';

interface MerchantFormData {
  name: string;
  description: string;
  category: string;
}

interface FormErrors {
  name?: string;
  description?: string;
  category?: string;
}

const CATEGORIES = [
  'Retail',
  'Food & Beverage',
  'Services',
  'Digital Goods',
  'Entertainment',
  'Other',
];

const MAX_NAME_LENGTH = 64;
const MAX_DESCRIPTION_LENGTH = 500;

const MerchantRegistrationWizard: React.FC = () => {
  const { address, isConnected, connect } = useWallet();
  const { callContract, isPending } = useContractCall();

  const [step, setStep] = useState<WizardStep>('wallet');
  const [formData, setFormData] = useState<MerchantFormData>({
    name: '',
    description: '',
    category: '',
  });
  const [errors, setErrors] = useState<FormErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [merchantId, setMerchantId] = useState<string | null>(null);

  const validate = (): boolean => {
    const nextErrors: FormErrors = {};

    const trimmedName = formData.name.trim();
    if (!trimmedName) {
      nextErrors.name = 'Name is required.';
    } else if (trimmedName.length > MAX_NAME_LENGTH) {
      nextErrors.name = `Name must be ${MAX_NAME_LENGTH} characters or fewer.`;
    }

    const trimmedDescription = formData.description.trim();
    if (!trimmedDescription) {
      nextErrors.description = 'Description is required.';
    } else if (trimmedDescription.length > MAX_DESCRIPTION_LENGTH) {
      nextErrors.description = `Description must be ${MAX_DESCRIPTION_LENGTH} characters or fewer.`;
    }

    if (!formData.category) {
      nextErrors.category = 'Please select a category.';
    }

    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const handleFieldChange = (
    field: keyof MerchantFormData,
    value: string,
  ) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    setErrors((prev) => ({ ...prev, [field]: undefined }));
  };

  const handleDetailsSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (validate()) {
      setStep('confirm');
    }
  };

  const handleRegister = async () => {
    setSubmitError(null);
    try {
      const result = await callContract('register_merchant', {
        name: formData.name.trim(),
        description: formData.description.trim(),
        category: formData.category,
      });

      const id =
        result && typeof result === 'object' && 'merchantId' in result
          ? String((result as { merchantId: unknown }).merchantId)
          : result != null
            ? String(result)
            : null;

      if (!id) {
        throw new Error('No merchant ID returned from the contract.');
      }

      setMerchantId(id);
      setStep('success');
    } catch (err) {
      setSubmitError(
        err instanceof Error ? err.message : 'Failed to register merchant.',
      );
    }
  };

  const handleConnect = async () => {
    try {
      await connect();
      setStep('details');
    } catch {
      // Connection errors are surfaced by the wallet hook.
    }
  };

  const renderStepIndicator = () => {
    const steps: { key: WizardStep; label: string }[] = [
      { key: 'wallet', label: 'Connect Wallet' },
      { key: 'details', label: 'Merchant Details' },
      { key: 'confirm', label: 'Confirm' },
      { key: 'success', label: 'Done' },
    ];
    const currentIndex = steps.findIndex((s) => s.key === step);

    return (
      <ol className="wizard-steps" aria-label="Registration progress">
        {steps.map((s, index) => (
          <li
            key={s.key}
            className={
              index === currentIndex
                ? 'wizard-step wizard-step--active'
                : index < currentIndex
                  ? 'wizard-step wizard-step--complete'
                  : 'wizard-step'
            }
            aria-current={index === currentIndex ? 'step' : undefined}
          >
            <span className="wizard-step__number">{index + 1}</span>
            <span className="wizard-step__label">{s.label}</span>
          </li>
        ))}
      </ol>
    );
  };

  return (
    <div className="merchant-registration-wizard">
      <h1>Register as a Merchant</h1>
      {renderStepIndicator()}

      {step === 'wallet' && (
        <section className="wizard-panel" aria-labelledby="wizard-wallet-title">
          <h2 id="wizard-wallet-title">Connect Your Wallet</h2>
          <p>
            Connect a Stellar wallet to begin merchant registration. Your wallet
            address will be associated with your merchant account.
          </p>
          {isConnected && address ? (
            <>
              <p className="wizard-wallet-address">
                Connected: <code>{address}</code>
              </p>
              <button
                type="button"
                className="btn btn--primary"
                onClick={() => setStep('details')}
              >
                Continue
              </button>
            </>
          ) : (
            <button
              type="button"
              className="btn btn--primary"
              onClick={handleConnect}
            >
              Connect Wallet
            </button>
          )}
        </section>
      )}

      {step === 'details' && (
        <section className="wizard-panel" aria-labelledby="wizard-details-title">
          <h2 id="wizard-details-title">Merchant Details</h2>
          <form onSubmit={handleDetailsSubmit} noValidate>
            <div className="form-field">
              <label htmlFor="merchant-name">Name</label>
              <input
                id="merchant-name"
                type="text"
                value={formData.name}
                maxLength={MAX_NAME_LENGTH}
                onChange={(e) => handleFieldChange('name', e.target.value)}
                aria-invalid={!!errors.name}
                aria-describedby={errors.name ? 'merchant-name-error' : undefined}
              />
              {errors.name && (
                <p id="merchant-name-error" className="form-error" role="alert">
                  {errors.name}
                </p>
              )}
            </div>

            <div className="form-field">
              <label htmlFor="merchant-description">Description</label>
              <textarea
                id="merchant-description"
                value={formData.description}
                maxLength={MAX_DESCRIPTION_LENGTH}
                rows={4}
                onChange={(e) =>
                  handleFieldChange('description', e.target.value)
                }
                aria-invalid={!!errors.description}
                aria-describedby={
                  errors.description ? 'merchant-description-error' : undefined
                }
              />
              <p className="form-hint">
                {formData.description.length}/{MAX_DESCRIPTION_LENGTH}
              </p>
              {errors.description && (
                <p
                  id="merchant-description-error"
                  className="form-error"
                  role="alert"
                >
                  {errors.description}
                </p>
              )}
            </div>

            <div className="form-field">
              <label htmlFor="merchant-category">Category</label>
              <select
                id="merchant-category"
                value={formData.category}
                onChange={(e) => handleFieldChange('category', e.target.value)}
                aria-invalid={!!errors.category}
                aria-describedby={
                  errors.category ? 'merchant-category-error' : undefined
                }
              >
                <option value="">Select a category…</option>
                {CATEGORIES.map((category) => (
                  <option key={category} value={category}>
                    {category}
                  </option>
                ))}
              </select>
              {errors.category && (
                <p
                  id="merchant-category-error"
                  className="form-error"
                  role="alert"
                >
                  {errors.category}
                </p>
              )}
            </div>

            <div className="wizard-actions">
              <button
                type="button"
                className="btn btn--secondary"
                onClick={() => setStep('wallet')}
              >
                Back
              </button>
              <button type="submit" className="btn btn--primary">
                Review
              </button>
            </div>
          </form>
        </section>
      )}

      {step === 'confirm' && (
        <section className="wizard-panel" aria-labelledby="wizard-confirm-title">
          <h2 id="wizard-confirm-title">Confirm &amp; Sign</h2>
          <p>
            Review your merchant details below. Submitting will prompt your
            wallet to sign the registration transaction.
          </p>
          <dl className="wizard-summary">
            <dt>Wallet</dt>
            <dd>
              <code>{address}</code>
            </dd>
            <dt>Name</dt>
            <dd>{formData.name.trim()}</dd>
            <dt>Description</dt>
            <dd>{formData.description.trim()}</dd>
            <dt>Category</dt>
            <dd>{formData.category}</dd>
          </dl>

          {submitError && (
            <p className="form-error" role="alert">
              {submitError}
            </p>
          )}

          <div className="wizard-actions">
            <button
              type="button"
              className="btn btn--secondary"
              onClick={() => setStep('details')}
              disabled={isPending}
            >
              Back
            </button>
            <button
              type="button"
              className="btn btn--primary"
              onClick={handleRegister}
              disabled={isPending}
              aria-busy={isPending}
            >
              {isPending ? (
                <>
                  <span className="spinner" aria-hidden="true" /> Signing…
                </>
              ) : (
                'Sign & Register'
              )}
            </button>
          </div>
        </section>
      )}

      {step === 'success' && (
        <section className="wizard-panel" aria-labelledby="wizard-success-title">
          <h2 id="wizard-success-title">Registration Complete</h2>
          <p>Your merchant account has been created successfully.</p>
          <p className="wizard-merchant-id">
            Merchant ID: <code>{merchantId}</code>
          </p>
          <div className="wizard-actions">
            <a href="/dashboard" className="btn btn--primary">
              Go to Dashboard
            </a>
          </div>
        </section>
      )}
    </div>
  );
};

export default MerchantRegistrationWizard;