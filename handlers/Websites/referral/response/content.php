<?php

/**
 * GET Websites/referral — redirect handler for referral links
 *
 * Resolved via Websites_Permalink: /slug → Websites/referral?slug=X
 * Records click, enriches geo, appends UTM, serves og: to crawlers.
 */
function Websites_referral_response_content()
{
    $slug = Q::ifset($_REQUEST, 'slug', '');
    if (!$slug) {
        header('HTTP/1.1 404 Not Found');
        echo 'Not found';
        exit;
    }

    $communityId = Users::communityId();
    $streamName = "Websites/referral/$slug";
    $stream = Streams::fetchOne(null, $communityId, $streamName);

    if (!$stream || $stream->closedTime) {
        header('HTTP/1.1 404 Not Found');
        echo 'Link not found or expired';
        exit;
    }

    $attrs = $stream->getAllAttributes();
    $destination = Q::ifset($attrs, 'destination', $stream->content);

    if (!$destination) {
        header('HTTP/1.1 404 Not Found');
        echo 'No destination configured';
        exit;
    }

    // ── Record click ─────────────────────────────────────────────────
    Websites_Referral::recordClick($stream);

    // ── Geo enrichment (if Places plugin available) ──────────────────
    if (Q::canHandle('Places/lookupFromRequest')) {
        try {
            $geo = Places::lookupFromRequest(array(
                'join' => array('city', 'country')
            ));
            // Could store geo data on stream or in a separate table
        } catch (Exception $e) {}
    }

    // ── Build destination with UTM ───────────────────────────────────
    $destination = Websites_Referral::appendUtm($destination, $attrs);

    // ── Visit chaining ───────────────────────────────────────────────
    $visitId = Metrics_Visit::currentId();
    if ($visitId) {
        $sep = (strpos($destination, '#') !== false) ? '&' : '#';
        $destination .= $sep . 'v=' . urlencode($visitId);
    }

    // ── Crawler detection — serve og: tags ───────────────────────────
    $ua = Q::ifset($_SERVER, 'HTTP_USER_AGENT', '');
    $isCrawler = (bool)preg_match(
        '/facebookexternalhit|Twitterbot|Slackbot|LinkedInBot'
        . '|Discordbot|TelegramBot|WhatsApp|Applebot'
        . '|Googlebot|bingbot|iMessageBot/i', $ua
    );

    // ── Build meta body ─────────────────────────────────────────────
    $scraped = Q::ifset($attrs, 'scraped', array());
    $meta = Q::ifset($attrs, 'meta', array());
    $ogTitle = Q::ifset($meta, 'title', '') ?: Q::ifset($scraped, 'title', $stream->title);
    $ogDesc  = Q::ifset($meta, 'description', '') ?: Q::ifset($scraped, 'description', '');
    $ogImage = Q::ifset($meta, 'image', '') ?: Q::ifset($scraped, 'image',
        Q::ifset($scraped, 'iconBig', ''));

    $twitterCard = Q::ifset($meta, 'twitter:card', 'summary_large_image');

    $metaBody = '<!DOCTYPE html><html><head><meta charset="utf-8">'
        . '<title>' . Q_Html::text($ogTitle) . '</title>'
        . '<meta property="og:title" content="' . Q_Html::text($ogTitle) . '">'
        . '<meta property="og:description" content="' . Q_Html::text($ogDesc) . '">'
        . '<meta property="og:url" content="' . Q_Html::text($attrs['destination']) . '">'
        . '<meta property="og:type" content="website">';
    if ($ogImage) {
        $metaBody .= '<meta property="og:image" content="' . Q_Html::text($ogImage) . '">';
    }
    $metaBody .= '<meta name="twitter:card" content="' . Q_Html::text($twitterCard) . '">'
        . '<meta name="twitter:title" content="' . Q_Html::text($ogTitle) . '">'
        . '<meta name="twitter:description" content="' . Q_Html::text($ogDesc) . '">'
        . ($ogImage ? '<meta name="twitter:image" content="' . Q_Html::text($ogImage) . '">' : '')
        . '<meta http-equiv="refresh" content="0;url=' . Q_Html::text($destination) . '">'
        . '</head><body></body></html>';

    if ($isCrawler) {
        header('HTTP/1.1 200 OK');
        header('Content-Type: text/html; charset=utf-8');
        echo $metaBody;
        exit;
    }

    // Browser: 302 with meta body as fallback
    Q::event('Websites/referral/redirect', compact('stream', 'destination', 'attrs'), 'before');
    header('HTTP/1.1 302 Found');
    header('Location: ' . $destination);
    header('Cache-Control: no-cache, no-store, must-revalidate');
    header('Content-Type: text/html; charset=utf-8');
    echo $metaBody;
    exit;
}
