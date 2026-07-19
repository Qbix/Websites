<?php

/**
 * @module Websites
 */

/**
 * Serves the theme CSS for a customer URL+formFactor.
 *
 * Query params:
 *   url           Required. The customer URL to extract theme from.
 *   formFactor    Optional. Defaults to Q_Request::formFactor().
 *   Q.Websites.reanalyze=1   Optional. Bypass cache and re-scrape.
 *                            Requires admin role.
 *
 * Response: text/css
 */
function Websites_theme_response()
{
    $url = Q::ifset($_GET, 'url', null);
    if (!$url) {
        header('Content-Type: text/css');
        echo "/* Websites/theme: missing url parameter */\n";
        return false;
    }

    $formFactor = Q::ifset($_GET, 'formFactor', null);
    if (!$formFactor) {
        $formFactor = Q_Request::formFactor();
    }
    $allowedFormFactors = array('mobile', 'tablet', 'desktop');
    if (!in_array($formFactor, $allowedFormFactors)) {
        $formFactor = 'desktop';
    }

    // Authorize reanalyze
    $reanalyze = false;
    if (Q_Request::special('Websites.reanalyze')) {
        $allowed = false;
        $user = Users::loggedInUser(false, false);
        if ($user) {
            $required = Q_Config::get(
                'Websites', 'theme', 'reanalyzeRoles',
                array('Websites/admins', 'Q/admins')
            );
            $roles = Users::roles();
            foreach ($required as $r) {
                if (isset($roles[$r])) {
                    $allowed = true;
                    break;
                }
            }
        }
        // Allow if config has loosened it for dev
        if (!$allowed && Q_Config::get('Websites', 'theme', 'reanalyzeAllowAll', false)) {
            $allowed = true;
        }
        $reanalyze = $allowed;
    }

    try {
        $path = Websites_Webpage::getThemeCssPath($url, $formFactor, array(
            'reanalyze' => $reanalyze
        ));
    } catch (Exception $e) {
        Q::log("Websites_theme_response error: " . $e->getMessage());
        header('Content-Type: text/css');
        echo "/* Theme generation failed: " . addslashes($e->getMessage()) . " */\n";
        return false;
    }

    header('Content-Type: text/css');
    $browserCache = (int)Q_Config::get('Websites', 'theme', 'browserCacheSeconds', 300);
    if ($browserCache > 0) {
        header("Cache-Control: public, max-age=$browserCache");
    } else {
        header("Cache-Control: no-cache");
    }
    readfile($path);
    return false;
}