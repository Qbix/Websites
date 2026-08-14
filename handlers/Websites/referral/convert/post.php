<?php

/**
 * POST Websites/referral/convert — record a referral conversion
 *
 * Called by destination sites when a referred visitor performs
 * a target action (signup, purchase, etc).
 *
 * Accepts either:
 *   - visitId (from invites.js cookie) — we walk the chain to find the referrer
 *   - userId (if destination is a Qbix app) — direct lookup
 *
 * If the invitee doesn't have a Qbix account but provides an email,
 * we create a futureUser so the referral is recorded for when they sign up.
 *
 * @param string $visitId  The Metrics visit ID from the tracking cookie
 * @param string $userId   The invitee's Qbix user ID (if known)
 * @param string $email    The invitee's email (for futureUser, optional)
 * @param string $event    The conversion event name (e.g. "signup", "purchase")
 * @param float  $value    Optional monetary value of the conversion
 */
function Websites_referral_convert_post()
{
    $visitId  = Q::ifset($_POST, 'visitId', '');
    $userId   = Q::ifset($_POST, 'userId', '');
    $email    = Q::ifset($_POST, 'email', '');
    $event    = Q::ifset($_POST, 'event', 'conversion');
    $value    = floatval(Q::ifset($_POST, 'value', 0));

    if (!$visitId && !$userId) {
        throw new Q_Exception("Either visitId or userId is required");
    }

    $communityId = Users::communityId();
    $referrerUserId = null;
    $referralStream = null;
    $trackerId = null;

    // ── Find the referrer by walking the visit chain ─────────────────
    if ($visitId) {
        $seen = array();
        $currentId = $visitId;
        $maxDepth = 20;

        while ($currentId && count($seen) < $maxDepth) {
            if (isset($seen[$currentId])) break;
            $seen[$currentId] = true;

            $visit = new Metrics_Visit();
            $visit->id = $currentId;
            if (!$visit->retrieve()) break;

            // If tracker is not a visit chain, we found the root
            if ($visit->trackerId
                && strpos($visit->trackerId, 'visitId:') !== 0
            ) {
                $trackerId = $visit->trackerId;

                // Find the referral stream by tracker
                $streamName = null;
                // Tracker ID format: publisherId/slug
                $parts = explode('/', $trackerId, 2);
                if (count($parts) === 2) {
                    $streamName = 'Websites/referral/' . $parts[1];
                }

                if ($streamName) {
                    $referralStream = Streams::fetchOne(
                        null, $communityId, $streamName
                    );
                    if ($referralStream) {
                        $attrs = $referralStream->getAllAttributes();
                        // The referrer is the stream's publisherId or inviterId
                        $referrerUserId = Q::ifset($attrs, 'inviterId', '')
                            ?: $referralStream->publisherId;
                    }
                }
                break;
            }

            // Walk up the chain
            if ($visit->trackerId
                && strpos($visit->trackerId, 'visitId:') === 0
            ) {
                $currentId = substr($visit->trackerId, 8);
            } else {
                break;
            }
        }
    }

    // ── Resolve or create the invitee user ────────────────────────────
    $inviteeUserId = null;

    if ($userId) {
        // Direct Qbix user ID provided
        $inviteeUser = Users::fetch($userId, false);
        if ($inviteeUser) {
            $inviteeUserId = $inviteeUser->id;
        }
    }

    if (!$inviteeUserId && $email) {
        // Try to find existing user by email, or create futureUser
        $email = strtolower(trim($email));
        if (Q_Valid::email($email)) {
            $futureUser = Users::futureUser('email', $email);
            if ($futureUser) {
                $inviteeUserId = $futureUser->id;
            }
        }
    }

    // ── Record the referral in Users_Referred ─────────────────────────
    $referralRecorded = false;
    if ($referrerUserId && $inviteeUserId) {
        // Resolve referrer to actual Qbix userId if it's an external ID
        $referrerUser = Users::fetch($referrerUserId, false);
        if ($referrerUser) {
            Users_Referred::handleReferral(
                $inviteeUserId,
                $communityId,
                'Websites/referral/convert',
                'Websites/referral',
                array('invitingUserId' => $referrerUser->id)
            );
            $referralRecorded = true;
        }
    }

    // ── Post conversion message on the referral stream ────────────────
    if ($referralStream) {
        $referralStream->post(null, array(
            'type'    => 'Websites/referral/converted',
            'content' => "Conversion: $event",
            'instructions' => Q::json_encode(array(
                'event'      => $event,
                'value'      => $value,
                'visitId'    => $visitId,
                'inviteeId'  => $inviteeUserId,
                'referrerId' => $referrerUserId
            ))
        ), true);
    }

    Q_Response::setSlot('result', array(
        'success'          => true,
        'event'            => $event,
        'referrerFound'    => !!$referrerUserId,
        'referralRecorded' => $referralRecorded,
        'trackerId'        => $trackerId,
        'visitChainDepth'  => isset($seen) ? count($seen) : 0
    ));
}
