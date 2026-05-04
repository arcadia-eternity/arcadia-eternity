import { Router, type Request, type Response } from 'express'
import { RuleRegistry } from '@arcadia-eternity/rules'
import { MatchingConfigManager } from '../../domain/matching/services/MatchingConfigManager'
import pino from 'pino'

const router: Router = Router()
const logger = pino({ name: 'RuleSetsAPI' })

/**
 * 获取所有规则集
 * GET /api/v1/rulesets
 */
router.get('/', async (req, res) => {
  try {
    const registry = RuleRegistry.getInstance()
    const ruleSets = registry.getEnabledRuleSets()

    const ruleSetInfos = ruleSets.map(ruleSet => ({
      id: ruleSet.id,
      name: ruleSet.name,
      description: ruleSet.description,
      version: ruleSet.version,
      author: ruleSet.author,
      tags: ruleSet.tags,
      enabled: ruleSet.enabled,
      ruleCount: ruleSet.rules.length,
      matchingConfig: ruleSet.matchingConfig,
    }))

    res.json({
      success: true,
      data: ruleSetInfos,
    })
  } catch (error) {
    logger.error({ error }, 'Failed to get rule sets')
    res.status(500).json({
      error: 'Failed to get rule sets',
      message: error instanceof Error ? error.message : 'Unknown error',
    })
  }
})

/**
 * 获取启用ELO匹配的规则集
 * GET /api/v1/rulesets/elo-enabled
 */
router.get('/elo-enabled', async (req, res) => {
  try {
    const registry = RuleRegistry.getInstance()
    const configManager = MatchingConfigManager.getInstance()
    const ruleSets = registry.getEnabledRuleSets()

    const eloEnabledRuleSets = ruleSets
      .filter(ruleSet => configManager.isEloMatchingEnabled(ruleSet.id))
      .map(ruleSet => ({
        id: ruleSet.id,
        name: ruleSet.name,
        description: ruleSet.description,
        version: ruleSet.version,
        author: ruleSet.author,
        tags: ruleSet.tags,
        enabled: ruleSet.enabled,
        ruleCount: ruleSet.rules.length,
        matchingConfig: ruleSet.matchingConfig,
        eloConfig: configManager.getEloConfig(ruleSet.id),
      }))

    res.json({
      success: true,
      data: eloEnabledRuleSets,
    })
  } catch (error) {
    logger.error({ error }, 'Failed to get ELO-enabled rule sets')
    res.status(500).json({
      error: 'Failed to get ELO-enabled rule sets',
      message: error instanceof Error ? error.message : 'Unknown error',
    })
  }
})

/**
 * 获取单个规则集详情
 * GET /api/v1/rulesets/:ruleSetId
 */
router.get('/:ruleSetId', async (req, res) => {
  try {
    const { ruleSetId } = req.params
    const registry = RuleRegistry.getInstance()
    const configManager = MatchingConfigManager.getInstance()

    const ruleSet = registry.getRuleSet(ruleSetId)
    if (!ruleSet) {
      return res.status(404).json({
        error: 'Rule set not found',
        message: `Rule set with ID "${ruleSetId}" does not exist`,
      })
    }

    const ruleSetInfo = {
      id: ruleSet.id,
      name: ruleSet.name,
      description: ruleSet.description,
      version: ruleSet.version,
      author: ruleSet.author,
      tags: ruleSet.tags,
      enabled: ruleSet.enabled,
      ruleCount: ruleSet.rules.length,
      matchingConfig: ruleSet.matchingConfig,
      isEloEnabled: configManager.isEloMatchingEnabled(ruleSet.id),
      eloConfig: configManager.getEloConfig(ruleSet.id),
      rules: ruleSet.rules.map(rule => ({
        id: rule.id,
        name: rule.name,
        description: rule.description,
        enabled: rule.enabled,
        priority: rule.priority,
        tags: rule.tags,
      })),
    }

    res.json({
      success: true,
      data: ruleSetInfo,
    })
  } catch (error) {
    logger.error({ error, ruleSetId: req.params.ruleSetId }, 'Failed to get rule set details')
    res.status(500).json({
      error: 'Failed to get rule set details',
      message: error instanceof Error ? error.message : 'Unknown error',
    })
  }
})

export default router
