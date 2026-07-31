<?php

/**
 * Websites/referral tool — PHP preloader
 *
 * Preloads the stream and recent click messages so the JS tool
 * renders immediately without a round-trip.
 */
function Websites_referral_tool($options)
{
    $publisherId = Q::ifset($options, 'publisherId', null);
    $streamName = Q::ifset($options, 'streamName', null);
    if (!$publisherId || !$streamName) return '';

    $asUserId = Users::loggedInUserId() ?: null;

    // Preload the stream
    $stream = Streams::fetchOne($asUserId, $publisherId, $streamName);
    if (!$stream) return '';
    $stream->addPreloaded($asUserId);

    // Preload recent click messages if user can see them
    if ($stream->testReadLevel('messages')) {
        $messages = Streams_Message::fetch(
            $publisherId, $streamName, array(
                'type' => 'Websites/referral/clicked',
                'limit' => Q::ifset($options, 'maxClicks', 50),
                'ascending' => false
            )
        );
        if ($messages) {
            Streams_Message::addPreloaded(
                $publisherId, $streamName, $messages
            );
        }
    }

    Q_Response::setToolOptions($options);
    return '';
}
