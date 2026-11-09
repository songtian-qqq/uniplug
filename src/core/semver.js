/**
 * Minimal semver: comparison + range matching.
 *
 * Supported ranges: `*`, `latest`, exact `1.2.3`, `^1.2.3`, `~1.2.3`,
 * `>=1.2.3`, `<=1.2.3`, `>1.2.3`, `<1.2.3`, `=1.2.3`,
 * space-separated intersections (`>=1.0.0 <2.0.0`) and `||` unions.
 *
 * Deliberately small: enough to express plugin dependency constraints
 * without pulling in a package.
 */

const RE = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;

export function parse(version) {
  const m = RE.exec(String(version).trim());
  if (!m) return null;
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
    prerelease: m[4] || null,
  };
}

export function valid(version) {
  return parse(version) !== null;
}

export function compareVersions(a, b) {
  const pa = parse(a);
  const pb = parse(b);
  if (!pa || !pb) return 0;
  for (const key of ['major', 'minor', 'patch']) {
    if (pa[key] !== pb[key]) return pa[key] < pb[key] ? -1 : 1;
  }
  if (pa.prerelease === pb.prerelease) return 0;
  if (!pa.prerelease) return 1;
  if (!pb.prerelease) return -1;
  return pa.prerelease < pb.prerelease ? -1 : 1;
}

function cmp(operator, version, rangeVersion) {
  const c = compareVersions(version, rangeVersion);
  switch (operator) {
    case '=': return c === 0;
    case '>': return c > 0;
    case '>=': return c >= 0;
    case '<': return c < 0;
    case '<=': return c <= 0;
    default: return false;
  }
}

function upperForCaret(p) {
  if (p.major > 0) return `${p.major + 1}.0.0`;
  if (p.minor > 0) return `0.${p.minor + 1}.0`;
  return `0.0.${p.patch + 1}`;
}

/** Test a comparator token such as `^1.2.3` against a parsed version. */
function testComparator(token, version) {
  token = token.trim();
  if (!token || token === '*' || token === 'x' || token === 'latest') return true;

  const m = /^(\^|~|>=|<=|>|<|=)?\s*v?(.+)$/.exec(token);
  if (!m) return false;
  const op = m[1] || '=';
  const target = m[2].trim();

  // Partial versions: `1`, `1.2`
  const partial = /^(\d+)(?:\.(\d+))?$/.exec(target);
  if (partial && (op === '=' || op === '^' || op === '~')) {
    const p = parse(version);
    if (!p) return false;
    if (p.major !== Number(partial[1])) return false;
    if (partial[2] !== undefined && p.minor !== Number(partial[2])) return false;
    return true;
  }

  if (!valid(target)) return false;
  const p = parse(version);
  if (!p) return false;

  if (op === '^') {
    return cmp('>=', version, target) && cmp('<', version, upperForCaret(parse(target)));
  }
  if (op === '~') {
    const t = parse(target);
    return cmp('>=', version, target) && cmp('<', version, `${t.major}.${t.minor + 1}.0`);
  }
  return cmp(op, version, target);
}

/**
 * @param {string} version concrete version, e.g. `1.4.2`
 * @param {string} range range expression, e.g. `^1.2.0 || >=2.0.0`
 */
export function satisfies(version, range) {
  if (range === undefined || range === null || range === '' || range === '*') return true;
  if (!valid(version)) return false;
  return String(range)
    .split('||')
    .some((union) => {
      const comparators = union.trim().split(/\s+/).filter(Boolean);
      return comparators.every((token) => testComparator(token, version));
    });
}

export function maxSatisfying(versions, range) {
  const matches = versions.filter((v) => satisfies(v, range));
  if (!matches.length) return null;
  return matches.sort(compareVersions).at(-1);
}
