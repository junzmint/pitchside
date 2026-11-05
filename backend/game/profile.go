package game

import (
	"log"
	"os"
	"strings"
	"time"
)

// profiler returns a lap timer that logs how long each step took, when PITCH_PROFILE=1.
// Usage: lap := profiler("new-season"); …; lap("step done").
func profiler(name string) func(step string) {
	if os.Getenv("PITCH_PROFILE") != "1" {
		return func(string) {}
	}
	start, last := time.Now(), time.Now()
	var b strings.Builder
	return func(step string) {
		now := time.Now()
		b.WriteString(step + " " + now.Sub(last).Round(time.Millisecond).String() + " · ")
		last = now
		if step == "analyze" || step == "done" {
			log.Printf("profile %s: %stotal %s", name, b.String(), now.Sub(start).Round(time.Millisecond))
		}
	}
}
