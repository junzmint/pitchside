package game

import "testing"

// The bigger the loan, the lower the rate (and the longer the term); the bank's limit follows reputation.
func TestLoanRatesFallWithSize(t *testing.T) {
	opts := LoanOptions(99)
	if len(opts) != len(loanTable) {
		t.Fatalf("a top club should see every loan: %d of %d", len(opts), len(loanTable))
	}
	for i := 1; i < len(opts); i++ {
		a, b := opts[i-1], opts[i]
		if b.Amount <= a.Amount || b.Rate >= a.Rate || b.Weeks < a.Weeks {
			t.Fatalf("loan %d (%d at %.2f over %d weeks) is not bigger, cheaper and longer than %d (%d at %.2f over %d weeks)",
				i, b.Amount, b.Rate, b.Weeks, i-1, a.Amount, a.Rate, a.Weeks)
		}
		if b.Total != int64(float64(b.Amount)*(1+b.Rate)) {
			t.Fatalf("total for %d: %d", b.Amount, b.Total)
		}
	}
	if got := LoanOptions(10); len(got) != 2 || got[len(got)-1].Amount != 25*M {
		t.Fatalf("reputation 10 (up to 30M) should see 10M and 25M: %+v", got)
	}
}
