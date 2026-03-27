const { COMPANY_PLATFORMS } = require('../config/company-platforms')
const { getCompanyPlatformConfig, ensureCompanyDb, companyTableHasColumn, findCompanyIdByName, fetchCompanyRowsForPlatform, aggregateCompanyRows } = require('../data/db')
const { sqlLiteral, runSqlite, runSqliteJson } = require('../utils/sqlite')
const { normalizeCompanyKey, persistEnvConfig } = require('../utils/helpers')

/**
 * Logica interna de guardado de empresa. Extraida del handler IPC para ser
 * reutilizada por el flujo OAuth auto-create.
 */
function saveCompanyInternal(payload = {}) {
  const nombre = String(payload.nombre || '').trim()
  const correo = String(payload.correo || '').trim()
  const telefono = String(payload.telefono || '').trim()
  const logo = String(payload.logo || '').trim()
  const sitioWeb = String(payload.sitio_web || '').trim()
  const direccion = String(payload.direccion || '').trim()
  const descripcion = String(payload.descripcion || '').trim()
  const colorPrimario = String(payload.color_primario || '#3469ED').trim()
  const colorCta = String(payload.color_cta || '#fd9102').trim()
  const colorAcento = String(payload.color_acento || '#00bcd4').trim()
  const colorChecks = String(payload.color_checks || '#28a745').trim()
  const colorFondo = String(payload.color_fondo || '#f0f0f5').trim()
  const payloadPlatforms = payload.platforms && typeof payload.platforms === 'object' ? payload.platforms : {}

  if (!nombre) {
    throw new Error('El nombre de la empresa es obligatorio.')
  }
  const selectedPlatforms = []
  const envUpdates = {}
  const companyActivo = payload.activo === false ? 0 : 1

  for (const platform of COMPANY_PLATFORMS) {
    const platformPayload = payloadPlatforms[platform] || {}
    const enabled = platformPayload.enabled === true
    const accounts = Array.isArray(platformPayload.accounts)
      ? platformPayload.accounts
          .slice(0, 5)
          .map((account, index) => ({
            account_index: index + 1,
            account_label: String(account?.account_label || '').trim(),
            token: String(account?.token || '').trim(),
            page_id: platform === 'facebook' ? String(account?.page_id || '').trim() : '',
            account_id: platform === 'instagram' ? String(account?.account_id || '').trim() : '',
          }))
          .filter((account) => account.token)
      : []

    if (enabled) {
      if (accounts.length === 0) {
        throw new Error(`Debes registrar al menos una cuenta para ${getCompanyPlatformConfig(platform).label}.`)
      }
      if (platform === 'facebook') {
        const invalidPageIdAccount = accounts.find((account) => !account.page_id)
        if (invalidPageIdAccount) {
          throw new Error('Cada cuenta de Facebook con token debe tener un Page ID.')
        }
      }
      selectedPlatforms.push({
        platform,
        syncToConfig: platformPayload.syncToConfig !== false,
        accounts,
      })
    }
  }

  if (selectedPlatforms.length === 0) {
    throw new Error('Selecciona al menos una red social para la empresa.')
  }

  for (const platform of COMPANY_PLATFORMS) {
    const dbPath = ensureCompanyDb(platform)
    const platformConfig = getCompanyPlatformConfig(platform)
    const hasLegacyCompanyTokenColumn = companyTableHasColumn(dbPath, 'token')
    const selectedPlatform = selectedPlatforms.find((entry) => entry.platform === platform)
    const existingCompanyId = findCompanyIdByName(dbPath, nombre)

    if (!selectedPlatform) {
      if (existingCompanyId) {
        runSqlite(
          dbPath,
          `
        PRAGMA foreign_keys=ON;
        DELETE FROM empresas
        WHERE id = ${sqlLiteral(existingCompanyId)};
        `
        )
      }
      continue
    }

    const primaryAccount = selectedPlatform.accounts[0]
    const primaryToken = primaryAccount?.token || ''
    let empresaId = existingCompanyId

    if (empresaId) {
      runSqlite(
        dbPath,
        `
      PRAGMA foreign_keys=ON;
      UPDATE empresas
      SET
        nombre = ${sqlLiteral(nombre)},
        ${hasLegacyCompanyTokenColumn ? `token = ${sqlLiteral(primaryToken)},` : ''}
        logo = ${sqlLiteral(logo || null)},
        telefono = ${sqlLiteral(telefono || null)},
        correo = ${sqlLiteral(correo || null)},
        sitio_web = ${sqlLiteral(sitioWeb || null)},
        direccion = ${sqlLiteral(direccion || null)},
        descripcion = ${sqlLiteral(descripcion || null)},
        color_primario = ${sqlLiteral(colorPrimario)},
        color_cta = ${sqlLiteral(colorCta)},
        color_acento = ${sqlLiteral(colorAcento)},
        color_checks = ${sqlLiteral(colorChecks)},
        color_fondo = ${sqlLiteral(colorFondo)},
        activo = ${companyActivo},
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ${sqlLiteral(empresaId)};
      `
      )
    } else {
      runSqlite(
        dbPath,
        `
      PRAGMA foreign_keys=ON;
      INSERT INTO empresas (
        nombre,
        ${hasLegacyCompanyTokenColumn ? 'token,' : ''}
        logo,
        telefono,
        correo,
        sitio_web,
        direccion,
        descripcion,
        color_primario,
        color_cta,
        color_acento,
        color_checks,
        color_fondo,
        activo,
        updated_at
      ) VALUES (
        ${sqlLiteral(nombre)},
        ${hasLegacyCompanyTokenColumn ? `${sqlLiteral(primaryToken)},` : ''}
        ${sqlLiteral(logo || null)},
        ${sqlLiteral(telefono || null)},
        ${sqlLiteral(correo || null)},
        ${sqlLiteral(sitioWeb || null)},
        ${sqlLiteral(direccion || null)},
        ${sqlLiteral(descripcion || null)},
        ${sqlLiteral(colorPrimario)},
        ${sqlLiteral(colorCta)},
        ${sqlLiteral(colorAcento)},
        ${sqlLiteral(colorChecks)},
        ${sqlLiteral(colorFondo)},
        ${companyActivo},
        CURRENT_TIMESTAMP
      );
      `
      )
      empresaId = findCompanyIdByName(dbPath, nombre)
    }

    if (!empresaId) {
      throw new Error(`No se pudo resolver el ID de ${nombre} para ${platformConfig.label}.`)
    }

    runSqlite(
      dbPath,
      `
    PRAGMA foreign_keys=ON;
    DELETE FROM ${platformConfig.table}
    WHERE empresa_id = ${sqlLiteral(empresaId)};
    `
    )

    const accountStatements = selectedPlatform.accounts.map((account, index) => `
    INSERT INTO ${platformConfig.table} (
      empresa_id,
      account_index,
      account_label,
      token,
      ${platform === 'facebook' ? 'page_id,' : ''}
      ${platform === 'instagram' ? 'account_id,' : ''}
      activo,
      is_primary,
      updated_at
    ) VALUES (
      ${sqlLiteral(empresaId)},
      ${sqlLiteral(account.account_index)},
      ${sqlLiteral(account.account_label || `Cuenta ${account.account_index}`)},
      ${sqlLiteral(account.token)},
      ${platform === 'facebook' ? `${sqlLiteral(account.page_id || null)},` : ''}
      ${platform === 'instagram' ? `${sqlLiteral(account.account_id || null)},` : ''}
      1,
      ${index === 0 ? 1 : 0},
      CURRENT_TIMESTAMP
    );
  `)

    runSqlite(dbPath, `PRAGMA foreign_keys=ON;\n${accountStatements.join('\n')}`)

    if (selectedPlatform.syncToConfig && primaryToken) {
      envUpdates[platformConfig.tokenEnvKey] = primaryToken
      if (platform === 'facebook' && primaryAccount?.page_id) {
        envUpdates.FB_PAGE_ID = primaryAccount.page_id
      }
    }
  }

  if (Object.keys(envUpdates).length > 0) {
    persistEnvConfig(envUpdates)
  }

  const rowsByPlatform = {}
  for (const platform of COMPANY_PLATFORMS) {
    rowsByPlatform[platform] = fetchCompanyRowsForPlatform(platform)
  }

  const savedCompany = aggregateCompanyRows(rowsByPlatform).find(
    (company) => normalizeCompanyKey(company.nombre) === normalizeCompanyKey(nombre)
  )

  if (!savedCompany) {
    throw new Error('No se pudo reconstruir el registro guardado.')
  }

  return savedCompany
}

function registerCompanyHandlers(ipcMain) {
  ipcMain.handle('list-company-records', async (_event, platform) => {
    try {
      const rowsByPlatform = {}
      for (const currentPlatform of COMPANY_PLATFORMS) {
        rowsByPlatform[currentPlatform] = fetchCompanyRowsForPlatform(currentPlatform)
      }
      return aggregateCompanyRows(rowsByPlatform)
    } catch (err) {
      throw new Error(err.message || 'No se pudo listar las empresas.')
    }
  })

  ipcMain.handle('save-company-record', async (_event, payload = {}) => {
    try {
      return saveCompanyInternal(payload)
    } catch (err) {
      throw new Error(err.message || 'No se pudo guardar la empresa.')
    }
  })

  ipcMain.handle('delete-company-record', async (_event, payload = {}) => {
    try {
      const companyName = String(payload.companyName || '').trim()

      if (!companyName) {
        throw new Error('El nombre de la empresa no es valido para eliminar.')
      }

      let deleted = false
      for (const platform of COMPANY_PLATFORMS) {
        const dbPath = ensureCompanyDb(platform)
        const empresaId = findCompanyIdByName(dbPath, companyName)
        if (!empresaId) continue
        runSqlite(
          dbPath,
          `
        PRAGMA foreign_keys=ON;
        DELETE FROM empresas
        WHERE id = ${sqlLiteral(empresaId)};
        `
        )
        deleted = true
      }

      if (!deleted) {
        throw new Error('No encontre el registro que intentas eliminar.')
      }

      return {
        success: true,
        deletedName: companyName,
      }
    } catch (err) {
      throw new Error(err.message || 'No se pudo eliminar la empresa.')
    }
  })

  ipcMain.handle('toggle-company-active', async (_event, payload = {}) => {
    try {
      const companyName = String(payload.companyName || '').trim()
      const nextActive = payload.active === false ? 0 : 1

      if (!companyName) {
        throw new Error('Debes indicar el nombre de la empresa para actualizar su estado.')
      }

      let updated = false
      for (const platform of COMPANY_PLATFORMS) {
        const dbPath = ensureCompanyDb(platform)
        const empresaId = findCompanyIdByName(dbPath, companyName)
        if (!empresaId) continue
        runSqlite(
          dbPath,
          `
        PRAGMA foreign_keys=ON;
        UPDATE empresas
        SET
          activo = ${nextActive},
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ${sqlLiteral(empresaId)};
        `
        )
        updated = true
      }

      if (!updated) {
        throw new Error(`No encontre la empresa ${companyName} para actualizar su estado.`)
      }

      return {
        success: true,
        companyName,
        active: nextActive,
      }
    } catch (err) {
      throw new Error(err.message || 'No se pudo actualizar el estado de la empresa.')
    }
  })

  ipcMain.handle('select-company-publication-account', async (_event, payload = {}) => {
    try {
      const companyName = String(payload.companyName || '').trim()
      const platform = String(payload.platform || '').trim().toLowerCase()
      const accountIndex = Number(payload.accountIndex || 0)

      if (!companyName) {
        throw new Error('Debes indicar la empresa para seleccionar la cuenta de publicacion.')
      }
      if (!COMPANY_PLATFORMS.has(platform)) {
        throw new Error('La red social seleccionada no es valida.')
      }
      if (!Number.isInteger(accountIndex) || accountIndex <= 0) {
        throw new Error('La cuenta seleccionada no es valida.')
      }

      const dbPath = ensureCompanyDb(platform)
      const platformConfig = getCompanyPlatformConfig(platform)
      const empresaId = findCompanyIdByName(dbPath, companyName)

      if (!empresaId) {
        throw new Error(`No encontre la empresa ${companyName} en ${platformConfig.label}.`)
      }

      const selectedRows = runSqliteJson(
        dbPath,
        `
      SELECT token, ${platform === 'facebook' ? 'page_id' : "'' AS page_id"}
      FROM ${platformConfig.table}
      WHERE empresa_id = ${sqlLiteral(empresaId)}
        AND account_index = ${sqlLiteral(accountIndex)}
      LIMIT 1;
      `
      )

      const selectedToken = String(selectedRows[0]?.token || '').trim()
      const selectedPageId = String(selectedRows[0]?.page_id || '').trim()
      if (!selectedToken) {
        throw new Error(`No encontre la cuenta ${accountIndex} de ${platformConfig.label} para ${companyName}.`)
      }
      if (platform === 'facebook' && !selectedPageId) {
        throw new Error(`La cuenta ${accountIndex} de Facebook no tiene Page ID configurado.`)
      }

      runSqlite(
        dbPath,
        `
      PRAGMA foreign_keys=ON;
      UPDATE ${platformConfig.table}
      SET
        is_primary = CASE WHEN account_index = ${sqlLiteral(accountIndex)} THEN 1 ELSE 0 END,
        updated_at = CURRENT_TIMESTAMP
      WHERE empresa_id = ${sqlLiteral(empresaId)};
      `
      )

      const envUpdates = {
        [platformConfig.tokenEnvKey]: selectedToken,
      }
      if (platform === 'facebook' && selectedPageId) {
        envUpdates.FB_PAGE_ID = selectedPageId
      }
      persistEnvConfig(envUpdates)

      return {
        success: true,
        companyName,
        platform,
        accountIndex,
        envKey: platform === 'facebook' ? `${platformConfig.tokenEnvKey} y FB_PAGE_ID` : platformConfig.tokenEnvKey,
      }
    } catch (err) {
      throw new Error(err.message || 'No se pudo seleccionar la cuenta para publicaciones.')
    }
  })
}

module.exports = { registerCompanyHandlers, saveCompanyInternal }
