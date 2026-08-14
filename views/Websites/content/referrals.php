<div class="Websites_referrals_page">
    <?= Q::tool('Websites/referrals', array(
        'publisherId' => $communityId,
        'streamName'  => $streamName,
        'baseUrl'     => $baseUrl,
        'creatable'   => true,
        'sortable'    => true
    ), 'Websites_referrals_main') ?>
</div>
