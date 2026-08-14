<?php

function Websites_referrals_response_content($params)
{
	Q::event('Websites/referrals/response/column', $params);
	return Q::view('Websites/content/columns.php');
}