<?php

/**
 * Websites_Referral — referral link management
 *
 * Creates tracked referral links with Metrics attribution,
 * Websites_Permalink resolution, and destination scraping.
 * Used standalone or extended by apps like Invites.
 */
class Websites_Referral
{
    /**
     * Create a referral link with tracking
     * @param string $asUserId
     * @param string $publisherId community
     * @param string $destination URL to redirect to
     * @param array $options
     *   slug, title, inviterId, credits, traits, metadata, noUtm
     * @return array {stream, tracker, permalink, url}
     */
    static function create($asUserId, $publisherId, $destination, $options = array())
    {
        $slug = Q::ifset($options, 'slug', '');
        if (!$slug) {
            $slug = self::generateSlug();
        }
        $slug = strtolower(trim($slug));

        // Validate slug
        if (!preg_match('/^[a-z0-9][a-z0-9\-]{1,63}$/', $slug)) {
            throw new Q_Exception("Slug must be 2-64 chars, lowercase alphanumeric and hyphens");
        }

        // Check slug uniqueness via permalink
        $existing = new Websites_Permalink();
        $existing->url = $slug;
        if ($existing->retrieve()) {
            throw new Q_Exception("Slug '$slug' is already taken");
        }

        // Scrape destination
        $scraped = array();
        try {
            $scraped = Websites_Webpage::scrape($destination);
        } catch (Exception $e) {}

        $title = Q::ifset($options, 'title', '');
        if (!$title) $title = Q::ifset($scraped, 'title', $destination);

        // Create the stream
        $streamName = "Websites/referral/$slug";
        $stream = Streams::create($asUserId, $publisherId, 'Websites/referral', array(
            'name'    => $streamName,
            'title'   => $title,
            'content' => $destination,
            'attributes' => Q::json_encode(array(
                'slug'        => $slug,
                'destination' => $destination,
                'inviterId'   => Q::ifset($options, 'inviterId', ''),
                'credits'     => Q::ifset($options, 'credits', array()),
                'metadata'    => Q::ifset($options, 'metadata', array()),
                'noUtm'       => Q::ifset($options, 'noUtm', false),
                'scraped'     => array(
                    'title'       => Q::ifset($scraped, 'title', ''),
                    'description' => Q::ifset($scraped, 'description', ''),
                    'iconSmall'   => Q::ifset($scraped, 'iconSmall', ''),
                    'iconBig'     => Q::ifset($scraped, 'iconBig', ''),
                    'image'       => Q::ifset($scraped, 'image', '')
                )
            ))
        ));

        // Create Metrics tracker
        $trackerId = $publisherId . '/' . $slug;
        $tracker = new Metrics_Tracker();
        $tracker->id = $trackerId;
        $tracker->publisherId = $asUserId;
        $tracker->sentCount = 0;
        $tracker->visitsCount = 0;
        $tracker->save(true);

        $stream->setAttribute('trackerId', $trackerId);
        $stream->changed($asUserId);

        // Attach traits if provided
        $traits = Q::ifset($options, 'traits', array());
        if ($traits) {
            self::attachTraits($trackerId, $traits);
        }

        // Create permalink
        $permalink = new Websites_Permalink();
        $permalink->uri = "Websites/referral slug=$slug";
        $permalink->url = $slug;
        $permalink->save();

        return array(
            'stream'    => $stream,
            'tracker'   => $tracker,
            'permalink' => $permalink,
            'slug'      => $slug,
            'trackerId' => $trackerId,
            'url'       => Q_Request::baseUrl() . '/' . $slug
        );
    }

    /**
     * Attach Metrics traits to a tracker
     */
    static function attachTraits($trackerId, $traits)
    {
        foreach ($traits as $name => $value) {
            $name = substr(trim($name), 0, 63);
            $value = substr(trim($value), 0, 63);
            if (!$name || !$value) continue;

            $traitId = Q_Utils::normalize($name) . '_' . Q_Utils::normalize($value);
            $traitId = substr($traitId, 0, 63);

            $trait = new Metrics_Trait();
            $trait->id = $traitId;
            if (!$trait->retrieve()) {
                $trait->name = $name;
                $trait->content = $value;
                $trait->sentTotal = 0;
                $trait->visitsTotal = 0;
            }
            $trait->save(true);

            $tt = new Metrics_TrackerTrait();
            $tt->trackerId = $trackerId;
            $tt->traitId = $traitId;
            $tt->save(true);
        }
    }

    /**
     * Record a click on a referral link.
     * Registers the Metrics hit on the referral URL (not the destination).
     * Sets canonicalActionId to the destination via Metrics_Action,
     * which uses Q_Uri internally to resolve canonical URLs.
     */
    static function recordClick($stream, $request = array())
    {
        $attrs = $stream->getAllAttributes();
        $trackerId = Q::ifset($attrs, 'trackerId', '');
        $slug = Q::ifset($attrs, 'slug', '');
        $destination = Q::ifset($attrs, 'destination', $stream->content);

        if ($trackerId) {
            $referralUrl = Q_Request::baseUrl() . '/' . $slug;

            // Register hit on our referral URL
            Metrics_Hit::registerUrl($referralUrl, $trackerId);

            // Set canonical to the destination so analytics can
            // group all referral links pointing to the same page.
            // Metrics_Action::fromUrl() creates the action if needed
            // and sets canonicalActionId from Q_Uri internally.
            $action = Metrics_Action::fromUrl($referralUrl);
            $canonicalId = Metrics_Action::idFromUrl($destination);
            if ($action && $canonicalId
                && $action->canonicalActionId !== $canonicalId
            ) {
                $action->canonicalActionId = $canonicalId;
                $action->save();
            }
        }

        // Post click message to stream
        $stream->post(null, array(
            'type'    => 'Websites/referral/clicked',
            'content' => 'Link clicked',
            'instructions' => Q::json_encode(array(
                'ip'        => Q_Request::ip(),
                'platform'  => Q_Request::platform(),
                'formFactor' => Q_Request::formFactor(),
                'referer'   => Q::ifset($_SERVER, 'HTTP_REFERER', '')
            ))
        ), true);
    }

    /**
     * Append UTM parameters to a destination URL
     */
    static function appendUtm($destination, $attrs, $baseSource = null)
    {
        if (Q::ifset($attrs, 'noUtm', false)) {
            return $destination;
        }

        $metadata = Q::ifset($attrs, 'metadata', array());
        $params = array(
            'utm_source'   => $baseSource ?: Q_Request::baseUrl(true),
            'utm_medium'   => 'referral',
            'utm_campaign' => Q::ifset($metadata, 'campaign', Q::ifset($attrs, 'slug', '')),
            'utm_term'     => Q::ifset($attrs, 'slug', '')
        );

        $inviterId = Q::ifset($attrs, 'inviterId', '');
        $slug = Q::ifset($attrs, 'slug', '');
        $params['utm_content'] = $inviterId ? "$inviterId/$slug" : $slug;

        if ($override = Q::ifset($metadata, 'utm_term', '')) {
            $params['utm_term'] = $override;
        }

        $parsed = parse_url($destination);
        $existingParams = array();
        if (isset($parsed['query'])) {
            parse_str($parsed['query'], $existingParams);
        }

        foreach ($params as $k => $v) {
            if (!isset($existingParams[$k]) && $v) {
                $existingParams[$k] = $v;
            }
        }

        $base = $parsed['scheme'] . '://' . $parsed['host']
            . (isset($parsed['port']) ? ':' . $parsed['port'] : '')
            . (isset($parsed['path']) ? $parsed['path'] : '/');

        return $base . '?' . http_build_query($existingParams)
            . (isset($parsed['fragment']) ? '#' . $parsed['fragment'] : '');
    }

    /**
     * Generate a random slug
     */
    static function generateSlug($length = 8)
    {
        $alphabet = Q_Config::get('Websites', 'referral', 'slug', 'alphabet',
            'abcdefghijkmnpqrstuvwxyz');
        $slug = '';
        $max = strlen($alphabet) - 1;
        for ($i = 0; $i < $length; $i++) {
            $slug .= $alphabet[random_int(0, $max)];
        }
        return $slug;
    }
}
