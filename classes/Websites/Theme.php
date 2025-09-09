<?php

class Websites_Theme {


    /**
     * Generate a layered theme CSS from the analyze() payload.
     * Useful to quickly approximate the look of the original page.
     *
     * @method generateThemeCss
     * @static
     * @param {array} $analysis The analysis payload returned by Websites_Webpage::analyze($url).
     * @param {array} [$options] Options hash:
     *   @param {string} [$options.scope=":root"] CSS scope selector to prefix rules.
     *       If not ":root", a mirror :root block with vars is also emitted.
     *   @param {boolean} [$options.important=true] Append "!important" to overrides.
     *   @param {boolean} [$options.includeFonts=true] Emit @font-face rules parsed from CSS.
     *   @param {int} [$options.maxFonts=6] Limit the number of @font-face blocks emitted.
     *   @param {string} [$options.baseFontFamily] Fallback font stack for body.
     *       Default: system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif
     *   @param {boolean} [$options.preferAnalysisFonts=true]
     *       If true, use the first discovered font family as primary for body.
     *
     * @return {string} CSS text, including:
     *   - @font-face rules (if includeFonts)
     *   - :root or scope variables (--theme-fg, --theme-bg, --theme-accent-1, --theme-accent-2, plus discovered vars)
     *   - Base body/link styles
     *   - Navigation overrides
     *   - Utility classes for largest content blocks
     */
    public static function generateCSS($analysis, $options = array())
    {
        // ------------- options -------------
        $scope                 = isset($options['scope']) ? $options['scope'] : ':root';
        $important             = array_key_exists('important', $options) ? (bool)$options['important'] : true;
        $includeFonts          = array_key_exists('includeFonts', $options) ? (bool)$options['includeFonts'] : true;
        $maxFonts              = isset($options['maxFonts']) ? (int)$options['maxFonts'] : 6;
        $baseFontFamily        = isset($options['baseFontFamily']) ? $options['baseFontFamily']
                                : 'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
        $preferAnalysisFonts   = array_key_exists('preferAnalysisFonts', $options) ? (bool)$options['preferAnalysisFonts'] : true;

        $bang = $important ? ' !important' : '';

        // ------------- helpers -------------
        $get = function ($arr /* , k1, k2, ... */) {
            $args = func_get_args();
            array_shift($args);
            foreach ($args as $k) {
                if (!is_array($arr) || !array_key_exists($k, $arr)) return null;
                $arr = $arr[$k];
            }
            return $arr;
        };

        $q = function ($s) { // quote a font family if it has spaces or special chars
            $s = trim($s);
            if ($s === '') return $s;
            if (preg_match('/^[a-zA-Z0-9\-]+$/', $s)) return $s;
            return '"' . str_replace('"', '\\"', $s) . '"';
        };

        $firstHex = function ($arr) {
            if (!is_array($arr)) return null;
            foreach ($arr as $e) {
                if (is_array($e) && isset($e['hex'])) return $e['hex'];
                if (is_string($e) && preg_match('/^#([0-9a-f]{6})$/i', $e)) return strtolower($e);
            }
            return null;
        };

        // ------------- palette -------------
        $fgTop = $firstHex($get($analysis, 'colorRoles', 'foreground'));
        $bgTop = $firstHex($get($analysis, 'colorRoles', 'background'));

        // If JS didn't split roles, fall back to dominant colors
        if (!$fgTop || !$bgTop) {
            $dom = $get($analysis, 'dominantColors');
            $domA = is_array($dom) ? $dom : array();
            $fgTop = $fgTop ? $fgTop : (isset($domA[0]['hex']) ? $domA[0]['hex'] : '#222222');
            $bgTop = $bgTop ? $bgTop : (isset($domA[1]['hex']) ? $domA[1]['hex'] : '#ffffff');
        }

        // A couple of accent guesses (2nd/3rd foreground or dominant)
        $fgList = $get($analysis, 'colorRoles', 'foreground');
        $acc1 = isset($fgList[1]['hex']) ? $fgList[1]['hex'] : null;
        $acc2 = isset($fgList[2]['hex']) ? $fgList[2]['hex'] : null;
        if (!$acc1 || !$acc2) {
            $dom = $get($analysis, 'dominantColors') ?: array();
            if (!$acc1 && isset($dom[1]['hex'])) $acc1 = $dom[1]['hex'];
            if (!$acc2 && isset($dom[2]['hex'])) $acc2 = $dom[2]['hex'];
        }
        if (!$acc1) $acc1 = '#4a90e2';
        if (!$acc2) $acc2 = '#e67e22';

        // root theme vars discovered on :root
        $rootVars = $get($analysis, 'rootThemeColors');
        $rootVarLines = array();
        if (is_array($rootVars)) {
            foreach ($rootVars as $name => $hex) {
                // ensure it's a var name (starts with --)
                if (strpos($name, '--') === 0 && is_string($hex)) {
                    $rootVarLines[] = '  ' . $name . ': ' . $hex . ';';
                }
            }
        }

        // ------------- fonts -------------
        $fonts          = $get($analysis, 'fonts');
        $fontFaces      = $get($analysis, '_assets', 'fontFaces');
        $fontFaceBlocks = array();
        $bodyFamily     = $baseFontFamily;

        if ($preferAnalysisFonts && is_array($fonts) && count($fonts)) {
            // Use first family token as body primary
            // Typical fontFamily string is like: 'Inter, "Helvetica Neue", Arial, sans-serif'
            $raw = $fonts[0];
            $primary = trim(strtok($raw, ','));
            if ($primary) $bodyFamily = $q($primary) . ', ' . $baseFontFamily;
        }

        if ($includeFonts && is_array($fontFaces)) {
            $count = 0;
            foreach ($fontFaces as $face) {
                if ($count >= $maxFonts) break;
                $fam   = $q((string)$get($face, 'family'));
                if (!$fam) continue;

                $style = $get($face, 'style');    $style = $style ? $style : 'normal';
                $weight= $get($face, 'weight');   $weight= $weight ? $weight : '400';

                $srcs  = $get($face, 'src');
                $urls  = array();
                if (is_array($srcs)) {
                    foreach ($srcs as $u) {
                        if (!is_string($u) || $u === '') continue;
                        // do minimal format infer: use .woff2/.woff/.ttf hints
                        $fmt = null;
                        if (strpos($u, 'format(') !== false) {
                            // already has format() from parsed CSS
                            $urls[] = 'url(' . $u . ')';
                            continue;
                        }
                        $lu = strtolower($u);
                        if (strpos($lu, '.woff2') !== false) $fmt = "format('woff2')";
                        elseif (strpos($lu, '.woff') !== false) $fmt = "format('woff')";
                        elseif (strpos($lu, '.ttf') !== false) $fmt = "format('truetype')";
                        elseif (strpos($lu, '.otf') !== false) $fmt = "format('opentype')";
                        elseif (strpos($lu, '.eot') !== false) $fmt = null; // rarely needed
                        elseif (strpos($lu, 'data:') === 0) $fmt = null;

                        $urls[] = "url('".$u."')".($fmt ? ' '.$fmt : '');
                    }
                }
                if (!count($urls)) continue;

                $fontFaceBlocks[] =
    "@font-face{
    font-family: {$fam};
    font-style: {$style};
    font-weight: {$weight};
    src: ".implode(",\n       ", $urls).";
    }";
                $count++;
            }
        }

        // ------------- nav -------------
        $nav = $get($analysis, 'detectedNav');
        $navCss = '';
        if (is_array($nav)) {
            $navFg = $get($nav, 'color') ?: $fgTop;
            $navBg = $get($nav, 'backgroundColor') ?: $bgTop;

            // Scope rule against a generic nav container inside the chosen scope.
            // If you are injecting the provided HTML snapshot, give it a wrapper class and adjust this selector.
            $navSel = ($scope === ':root') ? 'nav' : $scope . ' nav';

            $navCss =
    $navSel."{
    background-color: ".($navBg ?: 'transparent').$bang.";
    color: ".($navFg ?: '#222').$bang.";
    }
    ".$navSel." a{
    color: ".($navFg ?: '#222').$bang.";
    text-decoration: none".$bang.";
    }
    ".$navSel." a:hover, ".$navSel." a:focus{
    text-decoration: underline".$bang.";
    }";
        }

        // ------------- largest blocks -------------
        $blocks = $get($analysis, 'largestBlocks');
        $blockCss = '';
        if (is_array($blocks) && count($blocks)) {
            $i = 0;
            foreach ($blocks as $b) {
                if (++$i > 3) break;
                $fg = $get($b, 'color') ?: $fgTop;
                $bg = $get($b, 'backgroundColor') ?: 'transparent';
                // We don't know exact selector on your page; so we provide utility classes
                // that you can apply to your container when mapping content.
                $blockCss .=
    ".theme-block-{$i}{
    color: ".$fg.$bang.";
    background-color: ".$bg.$bang.";
    }";
            }
        }

        // ------------- variable block(s) -------------
        $vars =
    ($scope === ':root' ? ":root" : $scope)."{
    --theme-fg: ".$fgTop.";
    --theme-bg: ".$bgTop.";
    --theme-accent-1: ".$acc1.";
    --theme-accent-2: ".$acc2.";";
        if (count($rootVarLines)) $vars .= "\n" . implode("\n", $rootVarLines);
        $vars .= "\n}\n";

        // If scope != :root also emit a convenience :root mirror (optional)
        if ($scope !== ':root') {
            $vars .=
    ":root{
    --theme-fg: ".$fgTop.";
    --theme-bg: ".$bgTop.";
    --theme-accent-1: ".$acc1.";
    --theme-accent-2: ".$acc2.";
    }\n";
        }

        // ------------- base layer -------------
        $baseSel = ($scope === ':root') ? 'html, body' : $scope;
        $baseCss =
    $baseSel."{
    color: var(--theme-fg)".$bang.";
    background-color: var(--theme-bg)".$bang.";
    font-family: ".$bodyFamily.$bang.";
    }
    ".$baseSel." a{ color: var(--theme-accent-1)".$bang."; }
    ".$baseSel." a:hover, ".$baseSel." a:focus{ color: var(--theme-accent-2)".$bang."; }
    ";

        // ------------- assemble -------------
        $css = "/* Generated theme layer */\n";
        if ($includeFonts && count($fontFaceBlocks)) {
            $css .= "/* Fonts */\n".implode("\n\n", $fontFaceBlocks)."\n\n";
        }
        $css .= "/* Variables */\n".$vars."\n";
        $css .= "/* Base */\n".$baseCss."\n";
        if ($navCss) {
            $css .= "/* Navigation */\n".$navCss."\n";
        }
        if ($blockCss) {
            $css .= "/* Largest blocks (utility hooks) */\n".$blockCss."\n";
        }

        return $css;
    }


}