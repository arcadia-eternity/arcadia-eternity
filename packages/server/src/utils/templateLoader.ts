import * as fs from 'fs'
import * as path from 'path'
import handlebars from 'handlebars'
import { fileURLToPath } from 'url'

// Get the directory of the current module
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Template cache to avoid reading files repeatedly
const templateCache = new Map<string, HandlebarsTemplateDelegate>()
const textTemplateCache = new Map<string, HandlebarsTemplateDelegate>()

type HandlebarsTemplateDelegate = (context: any) => string

/**
 * Template data interface for verification emails
 */
export interface VerificationTemplateData {
  code: string
  purposeText: string
  playerName?: string
  subject: string
}

/**
 * Load and compile a Handlebars template
 */
function loadTemplate(
  templatePath: string,
  cache: Map<string, HandlebarsTemplateDelegate>,
): HandlebarsTemplateDelegate {
  if (cache.has(templatePath)) {
    return cache.get(templatePath)!
  }

  try {
    const templateContent = fs.readFileSync(templatePath, 'utf-8')
    const compiledTemplate = handlebars.compile(templateContent)
    cache.set(templatePath, compiledTemplate)
    return compiledTemplate
  } catch (error) {
    throw new Error(`Failed to load template from ${templatePath}: ${error}`)
  }
}

/**
 * Get the templates directory path
 */
function getTemplatesDir(): string {
  // Try multiple possible paths for templates directory
  const possiblePaths = [
    // Development path: from utils to templates
    path.join(__dirname, '..', 'templates'),
    // Built path: from dist/src/utils to dist/src/templates
    path.join(__dirname, '..', 'templates'),
    // Alternative built path
    path.join(process.cwd(), 'dist', 'src', 'templates'),
    // Development alternative
    path.join(process.cwd(), 'packages', 'server', 'src', 'templates'),
    // Current directory relative
    path.join(process.cwd(), 'src', 'templates'),
  ]

  for (const templatePath of possiblePaths) {
    if (fs.existsSync(templatePath)) {
      return templatePath
    }
  }

  // Fallback to the first path if none exist
  return possiblePaths[0]
}

/**
 * Render verification code email HTML template
 */
export function renderVerificationHtml(data: VerificationTemplateData): string {
  const templatesDir = getTemplatesDir()
  const templatePath = path.join(templatesDir, 'verification-code.hbs')
  const template = loadTemplate(templatePath, templateCache)
  return template(data)
}

/**
 * Render verification code email text template
 */
export function renderVerificationText(data: VerificationTemplateData): string {
  const templatesDir = getTemplatesDir()
  const templatePath = path.join(templatesDir, 'verification-code.txt')
  const template = loadTemplate(templatePath, textTemplateCache)
  return template(data)
}

/**
 * Clear template cache (useful for development)
 */
export function clearTemplateCache(): void {
  templateCache.clear()
  textTemplateCache.clear()
}

/**
 * Check if template files exist
 */
export function validateTemplates(): boolean {
  const templatesDir = getTemplatesDir()
  const htmlTemplate = path.join(templatesDir, 'verification-code.hbs')
  const textTemplate = path.join(templatesDir, 'verification-code.txt')

  return fs.existsSync(htmlTemplate) && fs.existsSync(textTemplate)
}
