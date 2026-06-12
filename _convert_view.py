# One-shot helper: converts a standalone GAS modal HTML file into an App view
# fragment (wrapper div + scoped CSS + script), applying mechanical renames.
# Hand-finishing (init extraction, guards) is done with editor edits afterward.
# This file is deleted before commit.
import io
import re
import sys


def prefix_css(css, prefix):
    out = []
    i = 0
    n = len(css)
    while i < n:
        m = re.match(r'\s+|/\*.*?\*/', css[i:], re.S)
        if m:
            out.append(m.group(0))
            i += m.end()
            continue
        j = css.find('{', i)
        if j == -1:
            out.append(css[i:])
            break
        sel = css[i:j]
        body_end = css.find('}', j)
        body = css[j:body_end + 1]
        parts = [p.strip() for p in sel.split(',') if p.strip()]
        prefixed = []
        for p in parts:
            if p == '*':
                prefixed.append(prefix + ' *')
            elif p == 'body' or p == 'html':
                prefixed.append(prefix)  # body rules land on the view root
            elif p.startswith('body'):
                prefixed.append(prefix + p[4:].strip() and (prefix + ' ' + p[4:].strip()) or prefix)
            else:
                prefixed.append(prefix + ' ' + p)
        out.append(',\n  '.join(prefixed) + ' ' + body)
        i = body_end + 1
    return ''.join(out)


def convert(src, dst, view_id, renames):
    t = io.open(src, encoding='utf-8').read()

    style = re.search(r'<style>(.*?)</style>', t, re.S).group(1)
    script = re.search(r'<script>(.*)</script>', t, re.S).group(1)
    body = re.search(r'<body>(.*?)<script>', t, re.S).group(1)

    css = prefix_css(style, '#' + view_id)
    # de-dup root selectors that collapsed from body/html
    css = css.replace('#%s {' % view_id, '#%s {' % view_id)

    frag = ('<div class="view" id="%s" hidden>\n' % view_id) + body.rstrip() + '\n</div>\n\n' \
           + '<style>\n' + css.strip() + '\n</style>\n\n' \
           + '<script>\n' + script.strip() + '\n</script>\n'

    for old, new in renames:
        frag = frag.replace(old, new)

    io.open(dst, 'w', encoding='utf-8').write(frag)
    print('wrote', dst, len(frag.split(chr(10))), 'lines')


if __name__ == '__main__':
    which = sys.argv[1]

    if which == 'import':
        convert('ScraperImport.html', 'ViewImport.html', 'view-import', [
            # element id 'status' -> 'importStatus' (markup + JS lookup)
            ("<div id=\"status\" class=\"status-bar empty\">", "<div id=\"importStatus\" class=\"status-bar empty\">"),
            ("getElementById('status')", "getElementById('importStatus')"),
            # function rename
            ("function setStatus(", "function setImportStatus("),
            ("setStatus(", "setImportStatus("),
            # panels were 100vh inline
            ("height:100vh", "height:100%"),
            ("height: 100vh", "height: 100%"),
        ])

    elif which == 'vinlog':
        convert('VINLogUpdater.html', 'ViewVinLog.html', 'view-vinlog', [
            ("id=\"dealerSelect\"", "id=\"vinlogDealerSelect\""),
            ("for=\"dealerSelect\"", "for=\"vinlogDealerSelect\""),
            ("getElementById('dealerSelect')", "getElementById('vinlogDealerSelect')"),
            ("#dealerSelect", "#vinlogDealerSelect"),
            ("id=\"vinCount\"", "id=\"vinlogVinCount\""),
            ("getElementById('vinCount')", "getElementById('vinlogVinCount')"),
            ("#vinCount", "#vinlogVinCount"),
            ("id=\"status\"", "id=\"vinlogStatus\""),
            ("getElementById('status')", "getElementById('vinlogStatus')"),
            ("#status", "#vinlogStatus"),
            ("function setStatus(", "function setVinlogStatus("),
            ("setStatus(", "setVinlogStatus("),
            ("function updateVinCount(", "function updateVinlogVinCount("),
            ("updateVinCount(", "updateVinlogVinCount("),
            ("oninput=\"updateVinlogVinCount()\"", "oninput=\"updateVinlogVinCount()\""),
            ("height:100vh", "height:100%"),
            ("height: 100vh", "height: 100%"),
        ])

    elif which == 'rules':
        convert('RulesEditor.html', 'ViewRules.html', 'view-rules', [
            ("id=\"dealerSelect\"", "id=\"rulesDealerSelect\""),
            ("for=\"dealerSelect\"", "for=\"rulesDealerSelect\""),
            ("getElementById('dealerSelect')", "getElementById('rulesDealerSelect')"),
            ("#dealerSelect", "#rulesDealerSelect"),
            ("id=\"status\"", "id=\"rulesStatus\""),
            ("getElementById('status')", "getElementById('rulesStatus')"),
            ("#status", "#rulesStatus"),
            ("function setStatus(", "function setRulesStatus("),
            ("setStatus(", "setRulesStatus("),
            ("height:100vh", "height:100%"),
            ("height: 100vh", "height: 100%"),
        ])

    elif which == 'run':
        convert('DealerSelector.html', 'ViewRun.html', 'view-run', [
            ("id=\"dealerSelect\"", "id=\"runDealerSelect\""),
            ("for=\"dealerSelect\"", "for=\"runDealerSelect\""),
            ("getElementById('dealerSelect')", "getElementById('runDealerSelect')"),
            ("#dealerSelect", "#runDealerSelect"),
            ("id=\"vinCount\"", "id=\"runVinCount\""),
            ("getElementById('vinCount')", "getElementById('runVinCount')"),
            ("#vinCount", "#runVinCount"),
            ("id=\"status\"", "id=\"runStatus\""),
            ("getElementById('status')", "getElementById('runStatus')"),
            ("#status", "#runStatus"),
            ("function setStatus(", "function setRunStatus("),
            ("setStatus(", "setRunStatus("),
            ("function updateVinCount(", "function updateRunVinCount("),
            ("updateVinCount(", "updateRunVinCount("),
            ("height:100vh", "height:100%"),
            ("height: 100vh", "height: 100%"),
        ])
