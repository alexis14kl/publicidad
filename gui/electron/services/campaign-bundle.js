const { facebookApiRequest, getMetaPageId, getTargetAdAccountId } = require('../facebook/api')
const { getDefaultMarketingSegment, buildTargetingSummary } = require('./segment')
const { buildLeadTargeting, buildLeadFormSpec, toMetaMoney, toMetaDateTime } = require('./orchestrator')
const { resolveCampaignObjectiveRule, resolveFacebookUiFlowRules, buildDraftLeadFormName } = require('../facebook/ui-campaign')

async function listLeadgenForms(token, pageId) {
  const result = await facebookApiRequest(
    'GET',
    `${String(pageId || '').trim()}/leadgen_forms`,
    {
      fields: 'id,name,status',
      limit: 50,
    },
    token
  )

  const forms = Array.isArray(result?.data) ? result.data : []
  return forms
    .map((form) => ({
      id: String(form?.id || ''),
      name: String(form?.name || 'Sin nombre'),
      status: String(form?.status || 'UNKNOWN'),
    }))
    .filter((form) => form.id)
}

function normalizeLeadQuestionKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
}

function summarizeLeadgenRequirements(questions) {
  const keys = new Set((questions || []).map((question) => normalizeLeadQuestionKey(question.key)))
  const hasEmail = keys.has('email')
  const hasPhone = keys.has('phone_number') || keys.has('phone')
  const hasFirstName = keys.has('first_name')
  const hasLastName = keys.has('last_name')
  const hasFullName = keys.has('full_name')

  return {
    hasEmail,
    hasPhone,
    hasFirstName,
    hasLastName,
    hasFullName,
    exactMatch: hasEmail && hasPhone && hasFullName,
    acceptableMatch: hasEmail && hasPhone && hasFirstName && hasLastName,
  }
}

async function getLeadgenFormQuestions(token, formId) {
  const result = await facebookApiRequest(
    'GET',
    String(formId || '').trim(),
    {
      fields: 'id,name,questions',
    },
    token
  )

  const questions = Array.isArray(result?.questions) ? result.questions : []
  return questions.map((question) => ({
    key: normalizeLeadQuestionKey(question?.key || question?.type || ''),
    label: String(question?.label || question?.key || question?.type || 'Sin etiqueta'),
    type: String(question?.type || ''),
  }))
}

async function enrichLeadgenFormsWithQuestions(token, forms) {
  const enriched = []

  for (const form of forms) {
    try {
      const questions = await getLeadgenFormQuestions(token, form.id)
      const requirements = summarizeLeadgenRequirements(questions)
      enriched.push({
        ...form,
        questions,
        requirements,
      })
    } catch (error) {
      enriched.push({
        ...form,
        questions: [],
        requirements: summarizeLeadgenRequirements([]),
        questionsError: error?.message || String(error),
      })
    }
  }

  return enriched
}

function selectBestLeadgenForm(forms) {
  const allForms = Array.isArray(forms) ? forms : []
  const exact = allForms.find((form) => form?.requirements?.exactMatch)
  if (exact) {
    return {
      id: exact.id,
      name: exact.name,
      matchType: 'exact',
      selectionReason: 'Seleccionado automaticamente por cumplir exacto con nombre completo, correo electronico y telefono movil.',
    }
  }

  const acceptable = allForms.find((form) => form?.requirements?.acceptableMatch)
  if (acceptable) {
    return {
      id: acceptable.id,
      name: acceptable.name,
      matchType: 'acceptable',
      selectionReason: 'No hubo coincidencia exacta; se encontro un formulario con nombre y apellido separados, correo y telefono.',
    }
  }

  return {
    id: '',
    name: '',
    matchType: 'none',
    selectionReason: 'No se encontro un formulario que cumpla con los campos requeridos.',
  }
}

function buildDraftCreativeConfig(preview, orchestrator) {
  const leadgenFormId = String(preview?.selectedLeadgenFormId || '').trim()
  const pageId = String(orchestrator?.execution?.pageId || getMetaPageId()).trim()
  const imageAssetPath = String(preview?.imageAsset?.preparedPath || '').trim()
  if (!leadgenFormId || !pageId || !imageAssetPath) {
    return null
  }

  return {
    pageId,
    leadgenFormId,
    imageAssetPath,
    callToActionType: 'SIGN_UP',
    objective: 'OUTCOME_LEADS',
    message: orchestrator?.adsAnalyst?.copy || '',
    headline: orchestrator?.adsAnalyst?.hook || '',
    description: orchestrator?.adsAnalyst?.strategicAngle || '',
    link: preview?.url || '',
    callToActionValue: {
      lead_gen_form_id: leadgenFormId,
    },
    objectStorySpec: {
      page_id: pageId,
      link_data: {
        link: preview?.url || '',
        message: orchestrator?.adsAnalyst?.copy || '',
        name: orchestrator?.adsAnalyst?.hook || '',
        description: orchestrator?.adsAnalyst?.strategicAngle || '',
        image_hash: 'PENDIENTE_UPLOAD_META',
        call_to_action: {
          type: 'SIGN_UP',
          value: {
            lead_gen_form_id: leadgenFormId,
          },
        },
      },
    },
    adDraftStatus: 'configured_waiting_asset',
  }
}

function buildDraftAdConfig(preview, creation) {
  const adsetId = String(creation?.adsetId || '').trim()
  const leadgenFormId = String(preview?.creativeDraftConfig?.leadgenFormId || '').trim()
  if (!adsetId || !leadgenFormId) {
    return null
  }

  return {
    adsetId,
    adName: `Ad Borrador | Lead Form ${leadgenFormId}`,
    status: 'PAUSED',
    creativeStatus: 'waiting_image_asset',
    tracking: {
      leadgen_form_id: leadgenFormId,
      page_id: String(preview?.creativeDraftConfig?.pageId || ''),
    },
  }
}

function buildLeadCampaignRunnerContext(preview, orchestrator) {
  const segment = orchestrator?.execution?.segment || getDefaultMarketingSegment()
  const objectiveRule = resolveCampaignObjectiveRule(preview, orchestrator)
  const uiRules = resolveFacebookUiFlowRules(preview, orchestrator)
  return {
    preview: {
      url: String(preview?.url || '').trim(),
      budget: String(preview?.budget || '').trim(),
      startDate: String(preview?.startDate || '').trim(),
      endDate: String(preview?.endDate || '').trim(),
      formFields: Array.isArray(preview?.formFields)
        ? preview.formFields.map((field) => String(field || '').trim()).filter(Boolean)
        : [],
    },
    execution: {
      accountHint: String(orchestrator?.execution?.accountHint || '').trim(),
      pageId: String(orchestrator?.execution?.pageId || getMetaPageId()).trim(),
      campaignType: String(orchestrator?.execution?.campaignType || '').trim(),
      targetingSummary: String(orchestrator?.execution?.targetingSummary || '').trim(),
      objectiveUiLabel: objectiveRule.uiLabel,
      apiObjective: objectiveRule.apiObjective,
      campaignName: String(orchestrator?.execution?.campaignName || uiRules.campaignName).trim(),
      adsetName: String(orchestrator?.execution?.adsetName || uiRules.adsetName).trim(),
      leadFormName: String(orchestrator?.execution?.leadFormName || buildDraftLeadFormName(preview, orchestrator)).trim(),
      budgetModeUiLabel: String(orchestrator?.execution?.budgetModeUiLabel || uiRules.budgetModeLabel).trim(),
      budgetModeUiAliases: Array.isArray(orchestrator?.execution?.budgetModeUiAliases)
        ? orchestrator.execution.budgetModeUiAliases.map((value) => String(value || '').trim()).filter(Boolean)
        : uiRules.budgetModeAliases,
      conversionLocationUiLabel: String(orchestrator?.execution?.conversionLocationUiLabel || uiRules.conversionLocationLabel).trim(),
      conversionLocationUiAliases: Array.isArray(orchestrator?.execution?.conversionLocationUiAliases)
        ? orchestrator.execution.conversionLocationUiAliases.map((value) => String(value || '').trim()).filter(Boolean)
        : uiRules.conversionLocationAliases,
      performanceGoalUiLabel: String(orchestrator?.execution?.performanceGoalUiLabel || uiRules.performanceGoalLabel).trim(),
      formFields: Array.isArray(orchestrator?.execution?.formFields)
        ? orchestrator.execution.formFields.map((field) => String(field || '').trim()).filter(Boolean)
        : [],
      leadFormFieldLabels: Array.isArray(orchestrator?.execution?.leadFormFieldLabels)
        ? orchestrator.execution.leadFormFieldLabels.map((field) => String(field || '').trim()).filter(Boolean)
        : uiRules.leadFormFieldLabels,
      leadFormRequiredKeys: Array.isArray(orchestrator?.execution?.leadFormRequiredKeys)
        ? orchestrator.execution.leadFormRequiredKeys.map((field) => String(field || '').trim()).filter(Boolean)
        : uiRules.leadFormRequiredKeys,
    },
    segment: {
      shortLabel: String(segment?.shortLabel || '').trim(),
      country: String(segment?.country || '').trim(),
      countryCode: String(segment?.countryCode || '').trim(),
      industry: String(segment?.industry || '').trim(),
      role: String(segment?.role || '').trim(),
      companySize: String(segment?.companySize || '').trim(),
      pain: String(segment?.pain || '').trim(),
      consequence: String(segment?.consequence || '').trim(),
      trigger: String(segment?.trigger || '').trim(),
      strategicAngle: String(segment?.strategicAngle || '').trim(),
      primaryCta: String(segment?.primaryCta || '').trim(),
      hook: String(segment?.hook || '').trim(),
      ageMin: Number(segment?.ageMin) || 0,
      ageMax: Number(segment?.ageMax) || 0,
    },
    agents: {
      orchestrator: {
        task: String(orchestrator?.plan?.task || '').trim(),
        reason: String(orchestrator?.plan?.reason || '').trim(),
      },
      adsAnalyst: {
        objective: String(orchestrator?.adsAnalyst?.objective || '').trim(),
        audience: String(orchestrator?.adsAnalyst?.audience || '').trim(),
        hook: String(orchestrator?.adsAnalyst?.hook || '').trim(),
        copy: String(orchestrator?.adsAnalyst?.copy || '').trim(),
        cta: String(orchestrator?.adsAnalyst?.cta || '').trim(),
        strategicAngle: String(orchestrator?.adsAnalyst?.strategicAngle || '').trim(),
        industry: String(orchestrator?.adsAnalyst?.industry || '').trim(),
        role: String(orchestrator?.adsAnalyst?.role || '').trim(),
        pain: String(orchestrator?.adsAnalyst?.pain || '').trim(),
        trigger: String(orchestrator?.adsAnalyst?.trigger || '').trim(),
      },
      imageCreator: {
        dimensions: String(orchestrator?.imageCreator?.dimensions || '').trim(),
        style: String(orchestrator?.imageCreator?.style || '').trim(),
        prompt: String(orchestrator?.imageCreator?.prompt || '').trim(),
      },
      marketing: {
        status: String(orchestrator?.marketing?.status || '').trim(),
        verdict: String(orchestrator?.marketing?.verdict || '').trim(),
        prompt: String(orchestrator?.marketing?.prompt || '').trim(),
        notes: Array.isArray(orchestrator?.marketing?.notes)
          ? orchestrator.marketing.notes.map((note) => String(note || '').trim()).filter(Boolean)
          : [],
        specialAdCategories: Array.isArray(orchestrator?.marketing?.compliance?.specialAdCategories)
          ? orchestrator.marketing.compliance.specialAdCategories.map((value) => String(value || '').trim()).filter(Boolean)
          : [],
        categoryStatement: String(orchestrator?.marketing?.compliance?.categoryStatement || '').trim(),
      },
    },
    uiFlow: {
      campaignObjectiveLabel: uiRules.campaignObjectiveLabel,
      campaignObjectiveAliases: uiRules.campaignObjectiveAliases,
      campaignName: uiRules.campaignName,
      budgetModeLabel: uiRules.budgetModeLabel,
      budgetModeAliases: uiRules.budgetModeAliases,
      budgetAmount: uiRules.budgetAmount,
      adsetName: uiRules.adsetName,
      conversionLocationLabel: uiRules.conversionLocationLabel,
      conversionLocationAliases: uiRules.conversionLocationAliases,
      performanceGoalLabel: uiRules.performanceGoalLabel,
      audienceLocationLabel: uiRules.audienceLocationLabel,
      leadFormFieldLabels: uiRules.leadFormFieldLabels,
      leadFormRequiredKeys: uiRules.leadFormRequiredKeys,
    },
  }
}

function buildLeadCampaignBundleSpec(preview, orchestrator) {
  const segment = orchestrator?.execution?.segment || getDefaultMarketingSegment()
  const objectiveRule = resolveCampaignObjectiveRule(preview, orchestrator)
  const uiRules = resolveFacebookUiFlowRules(preview, orchestrator)
  const campaignName = uiRules.campaignName
  const adsetName = uiRules.adsetName
  const pageId = String(orchestrator?.execution?.pageId || getMetaPageId()).trim()
  const contactMode = String(preview?.contactMode || '').trim()
  const isWhatsApp = contactMode === 'whatsapp'

  // Switch por modo de contacto: lead_form vs whatsapp
  const adsetConfig = isWhatsApp
    ? {
      optimization_goal: 'CONVERSATIONS',
      destination_type: 'WHATSAPP',
      ui_conversion_location_label: 'WhatsApp',
      ui_conversion_location_aliases: ['WhatsApp', 'Mensajes de WhatsApp'],
      ui_performance_goal_label: 'Maximizar el número de conversaciones',
    }
    : {
      optimization_goal: 'LEAD_GENERATION',
      destination_type: 'ON_AD',
      ui_conversion_location_label: uiRules.conversionLocationLabel,
      ui_conversion_location_aliases: uiRules.conversionLocationAliases,
      ui_performance_goal_label: uiRules.performanceGoalLabel,
    }

  const ctaType = isWhatsApp ? 'WHATSAPP_MESSAGE' : 'SIGN_UP'
  const selectedLeadgenFormId = isWhatsApp ? '' : String(preview?.selectedLeadgenFormId || '').trim()
  const creativeDraft = selectedLeadgenFormId
    ? buildDraftCreativeConfig({ ...preview, selectedLeadgenFormId }, orchestrator)
    : null
  const leadFormSpec = isWhatsApp ? null : buildLeadFormSpec(preview, orchestrator)

  return {
    ad_account_id: String(orchestrator?.execution?.accountHint || `act_${getTargetAdAccountId()}`),
    account_name: orchestrator?.execution?.accountHint || `act_${getTargetAdAccountId()}`,
    page_id: pageId,
    contact_mode: contactMode || 'lead_form',
    campaign: {
      name: campaignName,
      objective: objectiveRule.apiObjective,
      ui_objective_label: uiRules.campaignObjectiveLabel,
      status: 'PAUSED',
      is_adset_budget_sharing_enabled: false,
      special_ad_categories: orchestrator?.marketing?.compliance?.specialAdCategories || [],
    },
    adset: {
      name: adsetName,
      daily_budget: toMetaMoney(preview.budget),
      billing_event: 'IMPRESSIONS',
      optimization_goal: adsetConfig.optimization_goal,
      bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
      destination_type: adsetConfig.destination_type,
      ui_budget_mode_label: uiRules.budgetModeLabel,
      ui_budget_mode_aliases: uiRules.budgetModeAliases,
      ui_conversion_location_label: adsetConfig.ui_conversion_location_label,
      ui_conversion_location_aliases: adsetConfig.ui_conversion_location_aliases,
      ui_performance_goal_label: adsetConfig.ui_performance_goal_label,
      status: 'PAUSED',
      start_time: toMetaDateTime(preview.startDate, false),
      end_time: toMetaDateTime(preview.endDate, true),
      promoted_object: pageId
        ? {
          page_id: pageId,
        }
        : undefined,
      targeting: buildLeadTargeting(orchestrator),
    },
    lead_form: leadFormSpec,
    creative: {
      name: `Creative | ${segment.shortLabel} | ${isWhatsApp ? 'whatsapp' : (selectedLeadgenFormId || 'auto-form')}`,
      message: orchestrator?.adsAnalyst?.copy || '',
      headline: orchestrator?.adsAnalyst?.hook || '',
      description: orchestrator?.adsAnalyst?.strategicAngle || '',
      link: preview?.url || '',
      call_to_action_type: ctaType,
      image_path: String(preview?.imageAsset?.preparedPath || '').trim(),
      image_url: String(preview?.facebookPhotoUrl || '').trim(),
      object_story_spec: creativeDraft?.objectStorySpec || null,
    },
    ad: {
      name: `Ad | ${segment.shortLabel} | ${isWhatsApp ? 'whatsapp' : (selectedLeadgenFormId || 'auto-form')}`,
      status: 'PAUSED',
    },
    runner_context: buildLeadCampaignRunnerContext(preview, orchestrator),
  }
}

function pickFirstString(...values) {
  for (const value of values) {
    const normalized = String(value || '').trim()
    if (normalized) return normalized
  }
  return ''
}

function normalizeBundleAccount(bundleResult = {}) {
  const account =
    bundleResult?.account ||
    bundleResult?.ad_account ||
    bundleResult?.adAccount ||
    bundleResult?.result?.account ||
    bundleResult?.data?.account ||
    null

  if (account && typeof account === 'object') {
    return {
      ...account,
      id: pickFirstString(account.id, account.node_id, account.account_node, account.account_id ? `act_${String(account.account_id).replace(/^act_/, '').trim()}` : ''),
      account_id: pickFirstString(account.account_id, account.id),
      name: pickFirstString(account.name, account.account_name, account.label),
    }
  }

  const rawAccountId = pickFirstString(
    bundleResult?.ad_account_id,
    bundleResult?.account_id,
    bundleResult?.result?.ad_account_id,
    bundleResult?.data?.ad_account_id
  )

  if (!rawAccountId) return null

  return {
    id: rawAccountId.startsWith('act_') ? rawAccountId : `act_${rawAccountId}`,
    account_id: rawAccountId.replace(/^act_/, ''),
    name: rawAccountId.startsWith('act_') ? rawAccountId : `act_${rawAccountId}`,
  }
}

function applyMcpBundleResultToPreview(preview, orchestrator, bundleResult) {
  const forms = Array.isArray(bundleResult?.leadgen_forms) ? bundleResult.leadgen_forms : []
  const selectedForm = bundleResult?.selected_leadgen_form || {}
  const creationState = {
    account: normalizeBundleAccount(bundleResult),
    campaignId: pickFirstString(
      bundleResult?.campaign?.id,
      bundleResult?.campaignId,
      bundleResult?.campaign_id,
      bundleResult?.result?.campaign?.id,
      bundleResult?.result?.campaignId,
      bundleResult?.data?.campaign?.id,
      bundleResult?.data?.campaignId
    ),
    campaignName: pickFirstString(
      bundleResult?.campaign?.name,
      bundleResult?.campaignName,
      bundleResult?.campaign_name,
      bundleResult?.result?.campaign?.name,
      bundleResult?.result?.campaignName,
      bundleResult?.data?.campaign?.name,
      bundleResult?.data?.campaignName,
      orchestrator?.execution?.campaignName
    ),
    adsetId: pickFirstString(
      bundleResult?.adset?.id,
      bundleResult?.adsetId,
      bundleResult?.adset_id,
      bundleResult?.result?.adset?.id,
      bundleResult?.result?.adsetId,
      bundleResult?.data?.adset?.id,
      bundleResult?.data?.adsetId
    ),
    adsetName: pickFirstString(
      bundleResult?.adset?.name,
      bundleResult?.adsetName,
      bundleResult?.adset_name,
      bundleResult?.result?.adset?.name,
      bundleResult?.result?.adsetName,
      bundleResult?.data?.adset?.name,
      bundleResult?.data?.adsetName
    ),
    targetingSummary: String(bundleResult?.adset?.targeting_summary || orchestrator?.execution?.targetingSummary || buildTargetingSummary()),
    adsetError: String(bundleResult?.adset?.error || '').trim(),
    adsetDeferredToUi: Boolean(bundleResult?.adset?.deferred_to_ui),
  }

  preview.leadgenFormsLoaded = true
  preview.leadgenForms = forms
  preview.selectedLeadgenFormId = String(selectedForm?.id || '').trim()
  preview.selectedLeadgenFormName = String(selectedForm?.name || '').trim()
  preview.selectedLeadgenFormReason = String(selectedForm?.selectionReason || '').trim()
  preview.creativeDraftConfig = buildDraftCreativeConfig(preview, orchestrator)
  preview.adDraftConfig = buildDraftAdConfig(preview, creationState)
  preview.metaCreative = bundleResult?.creative?.id
    ? {
      creativeId: String(bundleResult.creative.id || ''),
      creativeName: String(bundleResult.creative.name || ''),
      imageHash: String(bundleResult.creative.image_hash || ''),
    }
    : null
  preview.metaAd = bundleResult?.ad?.id
    ? {
      adId: String(bundleResult.ad.id || ''),
      adName: String(bundleResult.ad.name || ''),
    }
    : null

  return creationState
}

module.exports = {
  listLeadgenForms,
  normalizeLeadQuestionKey,
  summarizeLeadgenRequirements,
  getLeadgenFormQuestions,
  enrichLeadgenFormsWithQuestions,
  selectBestLeadgenForm,
  buildDraftCreativeConfig,
  buildDraftAdConfig,
  buildLeadCampaignRunnerContext,
  buildLeadCampaignBundleSpec,
  applyMcpBundleResultToPreview,
}
