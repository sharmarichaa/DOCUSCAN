$form = @{ file = Get-Item "d:\Suraksha\DOCUSCAN\backend\test_loan_document.png" }
$resp = Invoke-RestMethod -Uri "http://localhost:8000/api/analyze" -Method Post -Form $form
$resp | ConvertTo-Json -Depth 5
