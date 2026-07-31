<?php

/**
 * POST Websites/referral — create a referral link
 */
function Websites_referral_post()
{
    $user = Users::loggedInUser(true);
    $communityId = Users::communityId();
    $destination = Q_Request::requireFields('destination', true);
    $slug = Q::ifset($_POST, 'slug', '');
    $title = Q::ifset($_POST, 'title', '');
    $inviterId = Q::ifset($_POST, 'inviterId', '');
    $traits = Q::ifset($_POST, 'traits', '');
    if ($traits && is_string($traits)) {
        $traits = Q::json_decode($traits);
    }

    $result = Websites_Referral::create($user->id, $communityId, $destination, array(
        'slug'      => $slug,
        'title'     => $title,
        'inviterId' => $inviterId,
        'traits'    => $traits ?: array()
    ));

    Q_Response::setSlot('result', array(
        'success'     => true,
        'publisherId' => $communityId,
        'streamName'  => $result['stream']->fields->name,
        'slug'        => $result['slug'],
        'trackerId'   => $result['trackerId'],
        'url'         => $result['url']
    ));
}
