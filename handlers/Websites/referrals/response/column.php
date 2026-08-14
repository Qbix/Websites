<?php

/**
 * GET Websites/referrals — management page for referral links
 *
 * Renders a column with the Websites/referrals tool showing
 * all referral links related to a category stream.
 */
function Websites_referrals_response_column(&$params, &$result)
{
    $communityId = Users::currentCommunityId(true);
    $user = Users::loggedInUser(true);

    // Check admin access
    $isAdmin = (bool)Users::roles(
        $communityId,
        array('Users/owners', 'Users/admins', 'Websites/admins'),
        array(),
        $user->id
    );

    if (!$isAdmin) {
        throw new Users_Exception_NotAuthorized();
    }

    $text = Q_Text::get('Websites/content');

    // The category stream that holds referral links
    // Default: Websites/referrals/main, overridable via request
    $streamName = Q::ifset($_REQUEST, 'streamName',
        'Websites/referrals/main');

    // Ensure the category stream exists
    $stream = Streams::fetchOneOrCreate($user->id, $communityId, $streamName, array(
        'fields' => array(
            'type'       => 'Streams/category',
            'title'      => Q::ifset($text, 'referral', 'ManageLinks', 'Referral Links'),
            'readLevel'  => 40,
            'writeLevel' => 0,
            'adminLevel' => 0
        ),
        'skipAccess' => true
    ));

    // Preload the stream + related referrals
    $stream->addPreloaded($user->id);
    list($relations, $relatedStreams) = Streams::related(
        $user->id, $communityId, $streamName,
        'Websites/referral', true,
        array('limit' => 50, 'ascending' => false)
    );
    foreach ($relatedStreams as $rs) {
        $rs->addPreloaded($user->id);
    }

    $baseUrl = Q::ifset($_REQUEST, 'baseUrl', Q_Request::baseUrl());

    $column = Q::view('Websites/content/referrals.php', compact(
        'communityId', 'streamName', 'baseUrl', 'text'
    ));

    $title = Q::ifset($text, 'referral', 'ManageLinks', 'Referral Links');
    $url = Q_Uri::url('Websites/referrals');

    Websites::$columns['referrals'] = array(
        'title'       => $title,
        'column'      => $column,
        'columnClass' => 'Websites_column_referrals',
        'close'       => false,
        'url'         => $url
    );

    return $column;
}
